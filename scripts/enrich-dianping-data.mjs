import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { cwd, env, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const sourcePath = join(root, "src", "data", "restaurants.ts");
const outputPath = join(root, "output", "sources", "dianping-enrichment.json");
const rawDir = join(root, "output", "sources", "dianping");
const chromeCandidates = [
  env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);
const chromeBin = chromeCandidates.find((candidate) => existsSync(candidate));

const cityIds = {
  beijing: 2,
  xiamen: 15,
  shanghai: 1,
  chengdu: 8,
  "hong-kong": 344,
};

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.slice(2).split("=");
  const value = inlineValue ?? process.argv[index + 1];
  args.set(key, value);
  if (inlineValue === undefined) index += 1;
}

const limit = Number(args.get("limit") ?? env.DIANPING_LIMIT ?? "490");
const cityFilter = args.get("city") ?? env.DIANPING_CITY;
const idFilter = args.get("id") ?? env.DIANPING_ID;
const keepGoingAfterBlock = env.DIANPING_IGNORE_BLOCK === "1";
const pauseOnLogin = env.DIANPING_PAUSE_ON_LOGIN === "1";
const saveRawArtifacts = env.DIANPING_SAVE_RAW === "1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readRestaurants() {
  const source = readFileSync(sourcePath, "utf8");
  const jsonStart = source.indexOf("= [") + 2;
  const jsonEnd = source.lastIndexOf("];");
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

function readExistingOutput() {
  if (!existsSync(outputPath)) {
    return {
      records: {},
    };
  }

  const payload = JSON.parse(readFileSync(outputPath, "utf8"));
  const records = {};
  Object.entries(payload.records ?? {}).forEach(([id, record]) => {
    const sanitized = sanitizeRecord(record);
    if (hasEnrichmentValue(sanitized)) records[id] = sanitized;
  });
  return { records };
}

function writeOutput(payload) {
  mkdirSync(join(root, "output", "sources"), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(typeof address === "object" && address, "Could not allocate port");
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
  const listUrl = `http://127.0.0.1:${debugPort}/json/list`;
  await waitForHttp(listUrl);

  let target = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const targets = await fetch(listUrl).then((response) => response.json());
    target = targets.find((item) => item.type === "page");
    if (target?.webSocketDebuggerUrl) break;
    await delay(250);
  }

  assert(target?.webSocketDebuggerUrl, "Could not find Chrome page target");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;

    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
      return;
    }
    resolve(message.result);
  });

  function send(method, params = {}) {
    const id = (nextId += 1);
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  return { socket, send };
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

function searchUrl(restaurant) {
  const cityId = cityIds[restaurant.city];
  if (!cityId) throw new Error(`Missing Dianping city id for ${restaurant.city}`);
  const query = encodeURIComponent(`${restaurant.name} ${restaurant.cityName}`);
  return `https://www.dianping.com/search/keyword/${cityId}/0_${query}`;
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[·'"’‘`.,，。_\-\s]/g, "");
}

function scoreMatch(expected, candidate) {
  const left = normalizeName(expected);
  const right = normalizeName(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (right.includes(left) || left.includes(right)) return 0.86;
  return 0;
}

function parsePrice(text) {
  const match = String(text ?? "").match(/人均\s*[¥￥:]?\s*(\d{2,5})/);
  return match ? Number(match[1]) : null;
}

function uniqueStrings(items, maxItems) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const value = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!value || seen.has(value) || value.length > 24) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= maxItems) break;
  }
  return result;
}

function sanitizeRecord(record) {
  const recommendedDishes = uniqueStrings(record?.recommendedDishes ?? [], 5);
  return {
    ...(Number.isFinite(record?.avgPriceCny)
      ? { avgPriceCny: Math.round(record.avgPriceCny) }
      : {}),
    ...(recommendedDishes.length ? { recommendedDishes } : {}),
    ...(typeof record?.url === "string" && record.url ? { url: record.url } : {}),
  };
}

function hasEnrichmentValue(record) {
  return (
    Number.isFinite(record?.avgPriceCny) ||
    (Array.isArray(record?.recommendedDishes) && record.recommendedDishes.length > 0) ||
    (typeof record?.url === "string" && record.url.length > 0)
  );
}

async function readSearchPage(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await delay(4500);
  await cdp.send("Runtime.evaluate", { expression: "window.scrollTo(0, document.body.scrollHeight / 2)" });
  await delay(900);

  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const bodyText = document.body?.innerText ?? "";
      const html = document.documentElement.outerHTML;
      const host = location.hostname;
      const url = location.href;
      const loginRequired =
        host.includes("account.dianping.com") ||
        url.includes("/login");
      const blocked =
        host.includes("verify.meituan.com") ||
        html.includes("yoda.seed") ||
        bodyText.includes("验证中心") ||
        bodyText.includes("访问过于频繁") ||
        bodyText.includes("Forbidden");
      const anchors = [...document.querySelectorAll('a[href*="/shop/"]')];
      const cards = anchors.slice(0, 12).map((anchor) => {
        const container =
          anchor.closest("li") ||
          anchor.closest(".txt") ||
          anchor.closest(".shop-info") ||
          anchor.parentElement;
        const text = (container?.innerText ?? anchor.innerText ?? "").replace(/\\s+/g, " ").trim();
        const href = new URL(anchor.getAttribute("href"), location.origin).href;
        return {
          name: (anchor.textContent ?? "").replace(/\\s+/g, " ").trim(),
          href,
          text,
        };
      });
      return {
        url: location.href,
        title: document.title,
        bodyText: bodyText.slice(0, 1200),
        loginRequired,
        blocked,
        cards,
      };
    })()`,
    returnByValue: true,
  });

  return result.result.value;
}

async function readSearchPageWithOptionalLoginPause(cdp, url) {
  let search = await readSearchPage(cdp, url);
  if (!search.loginRequired || !pauseOnLogin) return search;

  console.log("Dianping login/auth page detected. Complete login in the opened Chrome window; relay will retry for up to 10 minutes.");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await delay(3000);
    search = await readSearchPage(cdp, url);
    if (!search.loginRequired) return search;
  }

  return search;
}

async function readDetailPage(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await delay(4500);
  await cdp.send("Runtime.evaluate", { expression: "window.scrollTo(0, document.body.scrollHeight / 3)" });
  await delay(900);

  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const bodyText = document.body?.innerText ?? "";
      const html = document.documentElement.outerHTML;
      const host = location.hostname;
      const url = location.href;
      const loginRequired =
        host.includes("account.dianping.com") ||
        url.includes("/login");
      const blocked =
        host.includes("verify.meituan.com") ||
        html.includes("yoda.seed") ||
        bodyText.includes("验证中心") ||
        bodyText.includes("访问过于频繁") ||
        bodyText.includes("Forbidden");
      const dishNodes = [
        ...document.querySelectorAll('[class*="recommend"] [class*="name"], [class*="dish"] [class*="name"], .recommend-name, .dish-name')
      ];
      return {
        url: location.href,
        title: document.title,
        bodyText: bodyText.slice(0, 1800),
        loginRequired,
        blocked,
        dishes: dishNodes.map((node) => node.textContent?.replace(/\\s+/g, " ").trim()).filter(Boolean).slice(0, 10),
      };
    })()`,
    returnByValue: true,
  });

  return result.result.value;
}

function rawArtifactPath(restaurant, suffix) {
  mkdirSync(rawDir, { recursive: true });
  return join(rawDir, `${restaurant.id}-${suffix}.json`);
}

function resultFromBlocked(restaurant, search, status) {
  if (saveRawArtifacts) {
    const rawPath = rawArtifactPath(restaurant, status);
    writeFileSync(rawPath, `${JSON.stringify(search, null, 2)}\n`);
  }
  const reason =
    status === "login_required"
      ? "Dianping redirected to login/auth page"
      : "Dianping blocked browser relay";
  return { status, reason };
}

async function enrichOne(cdp, restaurant) {
  const url = searchUrl(restaurant);
  const search = await readSearchPageWithOptionalLoginPause(cdp, url);

  if (search.loginRequired) return resultFromBlocked(restaurant, search, "login_required");
  if (search.blocked) return resultFromBlocked(restaurant, search, "blocked");

  const candidates = search.cards
    .map((card) => ({
      ...card,
      matchScore: scoreMatch(restaurant.name, card.name),
    }))
    .filter((card) => card.matchScore > 0)
    .sort((left, right) => right.matchScore - left.matchScore);

  const best = candidates[0];
  if (!best || best.matchScore < 0.85) {
    if (saveRawArtifacts) {
      const rawPath = rawArtifactPath(restaurant, "not-found");
      writeFileSync(rawPath, `${JSON.stringify(search, null, 2)}\n`);
    }
    return { status: "not_found", reason: "No deterministic Dianping match found" };
  }

  const detail = await readDetailPage(cdp, best.href);
  if (detail.loginRequired) return resultFromBlocked(restaurant, detail, "login_required");
  if (detail.blocked) return resultFromBlocked(restaurant, detail, "blocked");

  const combinedText = `${best.text}\n${detail.bodyText}`;
  const recommendedDishes = uniqueStrings(detail.dishes, 5);
  if (saveRawArtifacts) {
    const rawPath = rawArtifactPath(restaurant, "matched");
    writeFileSync(rawPath, `${JSON.stringify({ search, detail, best }, null, 2)}\n`);
  }

  return {
    status: "matched",
    url: best.href,
    avgPriceCny: parsePrice(combinedText),
    recommendedDishes,
  };
}

let chrome = null;
let tempUserDataDir = null;

try {
  assert(chromeBin, "Chrome or Chromium is required for Dianping browser relay");

  const restaurants = readRestaurants()
    .filter((restaurant) => !cityFilter || restaurant.city === cityFilter)
    .filter((restaurant) => !idFilter || restaurant.id === idFilter)
    .slice(0, Number.isFinite(limit) ? limit : 490);
  assert(restaurants.length > 0, "No restaurants selected for Dianping enrichment");

  const debugPort = await getFreePort();
  const userDataDir = env.DIANPING_CHROME_USER_DATA_DIR;
  if (userDataDir) mkdirSync(userDataDir, { recursive: true });
  if (!userDataDir) tempUserDataDir = mkdtempSync(join(tmpdir(), "michelin-dianping-"));

  chrome = spawn(
    chromeBin,
    [
      env.DIANPING_HEADFUL === "1" ? "" : "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-sandbox",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${debugPort}`,
      "--window-size=1280,900",
      `--user-data-dir=${userDataDir ?? tempUserDataDir}`,
      "about:blank",
    ].filter(Boolean),
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const cdp = await openCdpSocket(debugPort);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const payload = readExistingOutput();
  payload.records = payload.records ?? {};

  for (const restaurant of restaurants) {
    const result = await enrichOne(cdp, restaurant);
    if (result.status === "matched" && hasEnrichmentValue(result)) {
      payload.records[restaurant.id] = sanitizeRecord(result);
    }
    writeOutput(payload);
    console.log(`${restaurant.name}: ${result.status}`);

    if ((result.status === "login_required" || result.status === "blocked") && !keepGoingAfterBlock) {
      console.log("Dianping relay stopped after auth/block response. Set DIANPING_IGNORE_BLOCK=1 to continue probing.");
      break;
    }

    await delay(1200);
  }

  await cdp.send("Browser.close").catch(() => undefined);
  cdp.socket.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
} finally {
  await stopProcess(chrome);
  if (tempUserDataDir && basename(tempUserDataDir).startsWith("michelin-dianping-")) {
    rmSync(tempUserDataDir, { recursive: true, force: true });
  }
}
