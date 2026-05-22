import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { cwd, env, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const viteBin = join(root, "node_modules", ".bin", "vite");
const chromeCandidates = [
  env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);
const chromeBin = chromeCandidates.find((candidate) => existsSync(candidate));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(typeof address === "object" && address, "Could not allocate port");
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`HTTP endpoint did not become ready: ${url}`);
}

async function openCdpSocket(debugPort) {
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) =>
    response.json(),
  );
  const target = targets.find((item) => item.type === "page");
  assert(target?.webSocketDebuggerUrl, "Could not find Chrome page target");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const eventWaiters = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
        return;
      }
      resolve(message.result);
      return;
    }

    const waiters = eventWaiters.get(message.method);
    if (waiters) {
      eventWaiters.delete(message.method);
      waiters.splice(0).forEach((waiter) => waiter.resolve(message.params));
    }
  });

  function send(method, params = {}) {
    const id = (nextId += 1);
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  function waitForEvent(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const waiters = eventWaiters.get(method) ?? [];
      waiters.push({
        resolve: (params) => {
          clearTimeout(timer);
          resolve(params);
        },
      });
      eventWaiters.set(method, waiters);
    });
  }

  return { socket, send, waitForEvent };
}

function stopProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(resolveTimer);
      resolve();
    };
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 800);
    const resolveTimer = setTimeout(finish, 2500);

    child.once("exit", finish);
    child.kill("SIGTERM");
  });
}

let server = null;
let chrome = null;
let userDataDir = null;

try {
  assert(chromeBin, "Chrome or Chromium is required for offline verification");
  assert(existsSync(viteBin), "Run npm install before offline verification");

  const swSource = readFileSync(join(root, "public/sw.js"), "utf8");
  const mainSource = readFileSync(join(root, "src/main.tsx"), "utf8");
  const indexSource = readFileSync(join(root, "index.html"), "utf8");
  const mapSource = readFileSync(join(root, "src/components/MapView.tsx"), "utf8");
  const guidesSource = readFileSync(join(root, "src/data/guides.ts"), "utf8");
  const styleSource = readFileSync(join(root, "src/styles.css"), "utf8");

  assert(indexSource.includes("manifest.webmanifest"), "App manifest is not linked");
  assert(mainSource.includes("serviceWorker") && mainSource.includes("sw.js"), "Service worker is not registered");
  assert(swSource.includes("CACHE_NAME") && swSource.includes("APP_SHELL"), "Service worker app shell cache is missing");
  assert(
    swSource.includes("/michelin-star-white.svg") && existsSync(join(root, "public/michelin-star-white.svg")),
    "Offline cache is missing the white Michelin star marker asset",
  );
  assert(
    swSource.includes("/michelin-bib-gourmand-white.svg") &&
      existsSync(join(root, "public/michelin-bib-gourmand-white.svg")),
    "Offline cache is missing the Bib Gourmand marker asset",
  );
  assert(
    swSource.includes("/restaurant-selected-white.svg") &&
      existsSync(join(root, "public/restaurant-selected-white.svg")),
    "Offline cache is missing the selected restaurant marker asset",
  );
  for (const fontFile of [
    "openai-sans-v2-regular.woff2",
    "openai-sans-v2-medium.woff2",
    "openai-sans-v2-semibold.woff2",
    "openai-sans-v2-bold.woff2",
  ]) {
    assert(
      swSource.includes(`/fonts/${fontFile}`) && existsSync(join(root, "public/fonts", fontFile)),
      `Offline cache is missing the OpenAI Sans v2 font asset: ${fontFile}`,
    );
  }
  assert(!swSource.includes("webapi.amap.com") && !swSource.includes("autonavi.com"), "Service worker must not cache AMap tiles or JSAPI");
  assert(mapSource.includes('MapStatus = "missing-key" | "loading" | "ready" | "failed" | "offline"'), "Offline map status is not modeled");
  assert(mapSource.includes("OfflineCityMap"), "Offline city map component is missing");
  assert(styleSource.includes(".offline-city-map"), "Offline city map styles are missing");
  assert(
    guidesSource.includes("michelin-star-white.svg") &&
      mapSource.includes("michelin-bib-gourmand-white.svg") &&
      mapSource.includes("restaurant-selected-white.svg") &&
      !styleSource.includes('mask: url("/bib-gourmand-white.png")'),
    "Offline marker icons are not backed by the local star, Bib Gourmand, and selected SVG images",
  );

  const port = String(await getFreePort());
  const debugPort = String(await getFreePort());
  const appUrl = `http://127.0.0.1:${port}/`;
  userDataDir = mkdtempSync(join(tmpdir(), "michelin-offline-"));

  server = spawn(viteBin, ["--host", "127.0.0.1", "--port", port, "--strictPort"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHttp(appUrl);

  chrome = spawn(
    chromeBin,
    [
      "--headless",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      "--no-sandbox",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${debugPort}`,
      "--window-size=1440,1000",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const cdp = await openCdpSocket(debugPort);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(Navigator.prototype, "onLine", { get: () => false });`,
  });

  const loaded = cdp.waitForEvent("Page.loadEventFired", 10000);
  await cdp.send("Page.navigate", { url: appUrl });
  await loaded;
  await delay(1000);

  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => ({
      status: document.querySelector(".amap-surface")?.getAttribute("data-amap-status"),
      offlineMap: Boolean(document.querySelector(".offline-city-map")),
      offlineMarkers: document.querySelectorAll(".offline-city-map__marker").length,
      starPins: document.querySelectorAll(".offline-city-map__marker .map-marker__pin-icon--star").length,
      bibPins: document.querySelectorAll(".offline-city-map__marker .map-marker__pin-icon--bib").length,
      bibSvgPins: document.querySelectorAll('.offline-city-map__marker img[src*="michelin-bib-gourmand-white.svg"]').length,
      selectedPins: document.querySelectorAll(".offline-city-map__marker .map-marker__pin-icon--selected").length,
      selectedSvgPins: document.querySelectorAll('.offline-city-map__marker img[src*="restaurant-selected-white.svg"]').length,
      centerLabel: document.querySelector(".offline-city-map__center")?.textContent?.trim() ?? "",
      swController: Boolean(navigator.serviceWorker)
    }))()`,
    returnByValue: true,
  });

  const value = result.result.value;
  assert(value.status === "offline", `Offline map status did not activate: ${JSON.stringify(value)}`);
  assert(value.offlineMap, `Offline city map did not render: ${JSON.stringify(value)}`);
  assert(value.offlineMarkers > 0, `Offline map markers did not render: ${JSON.stringify(value)}`);
  assert(value.starPins > 0, `Offline Michelin star marker icons did not render: ${JSON.stringify(value)}`);
  assert(value.bibPins > 0, `Offline Bib Gourmand marker icons did not render: ${JSON.stringify(value)}`);
  assert(value.bibSvgPins > 0, `Offline Bib Gourmand SVG marker icons did not render: ${JSON.stringify(value)}`);
  assert(value.selectedPins > 0, `Offline selected marker icons did not render: ${JSON.stringify(value)}`);
  assert(value.selectedSvgPins > 0, `Offline selected SVG marker icons did not render: ${JSON.stringify(value)}`);
  assert(value.centerLabel, `Offline city center label did not render: ${JSON.stringify(value)}`);

  await Promise.race([
    cdp.send("Browser.close").catch(() => undefined),
    delay(500),
  ]);
  cdp.socket.close();
  console.log(
    `Offline verification passed: status=${value.status}, markers=${value.offlineMarkers}, starPins=${value.starPins}, bibPins=${value.bibPins}, selectedPins=${value.selectedPins}, center=${value.centerLabel}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
} finally {
  await Promise.all([stopProcess(chrome), stopProcess(server)]);
  if (userDataDir) {
    rmSync(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
  }
}
