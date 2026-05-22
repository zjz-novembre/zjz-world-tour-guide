import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { cwd, env, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const port = env.AMAP_TEST_PORT ?? "5182";
const appUrl = env.APP_URL ?? `http://127.0.0.1:${port}/`;
const viteBin = join(root, "node_modules", ".bin", "vite");

const chromeCandidates = [
  env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

const chromeBin = chromeCandidates.find((candidate) => existsSync(candidate));
const mapViewSource = readFileSync(join(root, "src/components/MapView.tsx"), "utf8");
const amapSource = readFileSync(join(root, "src/lib/amap.ts"), "utf8");
const stylesSource = readFileSync(join(root, "src/styles.css"), "utf8");
const runtimeConfigPath = join(root, "public/amap-config.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(800),
      });
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Vite server did not become ready at ${url}`);
}

let server = null;

try {
  assert(chromeBin, "Chrome or Chromium is required for runtime verification");
  assert(
    mapViewSource.includes('"amap://styles/whitesmoke"') &&
      mapViewSource.includes("setMapStyle"),
    "AMap white smoke style is not configured in MapView",
  );
  assert(
    mapViewSource.includes("showLabel: true") && !mapViewSource.includes("showLabel: false"),
    "AMap road labels are not enabled",
  );
  assert(
    mapViewSource.includes("getZoomBand") && mapViewSource.includes("data-amap-zoom-band"),
    "Zoom-based restaurant tag state is not wired",
  );
  assert(
    amapSource.includes("https://webapi.amap.com/maps"),
    "AMap JSAPI loader URL is missing",
  );
  assert(
    !amapSource.includes('plugin: "AMap.PlaceSearch"'),
    "AMap PlaceSearch plugin is still bundled into the first map load",
  );
  assert(
    amapSource.includes('new URL("amap-config.json", getAppBaseUrl())'),
    "Runtime AMap config fetch is missing",
  );
  assert(
    mapViewSource.includes("amap-surface--"),
    "AMap status class is not wired on the map surface",
  );
  assert(
    stylesSource.includes(".amap-surface--missing-key::before"),
    "Missing-key AMap surface has no nonblank white-smoke map treatment",
  );
  assert(
    existsSync(join(root, "public/michelin-guide.svg")),
    "Michelin guide filter icon asset is missing",
  );
  assert(
    existsSync(join(root, "public/michelin-star-white.svg")),
    "White Michelin star marker asset is missing",
  );
  assert(
    existsSync(join(root, "public/michelin-bib-gourmand-white.svg")),
    "Bib Gourmand marker asset is missing",
  );
  assert(
    existsSync(join(root, "public/restaurant-selected-white.svg")),
    "Selected restaurant marker asset is missing",
  );
  assert(
    mapViewSource.includes("map-marker__pin-icon--star") &&
      mapViewSource.includes("map-marker__pin-icon--bib") &&
      mapViewSource.includes("map-marker__pin-icon--selected") &&
      mapViewSource.includes("michelin-bib-gourmand-white.svg") &&
      mapViewSource.includes("restaurant-selected-white.svg"),
    "Map markers are not wired to star, Bib Gourmand, and selected pin icons",
  );
  assert(
    !stylesSource.includes('mask: url("/bib-gourmand-white.png")') &&
      !mapViewSource.includes("bib-gourmand-white.png"),
    "Map markers still reference the old Bib Gourmand PNG mask",
  );
  assert(
    stylesSource.includes(".map-marker--bib-gourmand .map-marker__pin") &&
      stylesSource.includes("background: var(--color-gold)"),
    "Bib Gourmand markers do not use the Bib yellow pin background",
  );
  assert(
    stylesSource.includes(".map-marker--selected .map-marker__pin") &&
      stylesSource.includes("background: var(--color-muted)"),
    "Selected markers do not use the selected gray pin background",
  );

  if (!env.APP_URL) {
    assert(existsSync(viteBin), "Run npm install before runtime verification");
    server = spawn(
      viteBin,
      ["--host", "127.0.0.1", "--port", port, "--strictPort"],
      {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    server.on("error", (error) => {
      throw error;
    });

    await waitForServer(appUrl);
  }

  const result = spawnSync(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--window-size=500,844",
      "--virtual-time-budget=22000",
      "--dump-dom",
      appUrl,
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (result.error) throw result.error;
  assert(result.status === 0, result.stderr || "Chrome failed to dump DOM");

  const dom = result.stdout;
  assert(dom.includes("amap-surface"), "AMap surface was not mounted");
  assert(dom.includes("map-marker__tag"), "Restaurant map tags were not rendered");
  assert(dom.includes("map-marker__pin-icon--star"), "Michelin star marker pin icons were not rendered");
  assert(dom.includes("map-marker__pin-icon--bib"), "Bib Gourmand marker pin icons were not rendered");
  assert(dom.includes("map-marker__pin-icon--selected"), "Selected restaurant marker pin icons were not rendered");
  assert(dom.includes("michelin-bib-gourmand-white.svg"), "Bib Gourmand marker SVG was not rendered");
  assert(dom.includes("restaurant-selected-white.svg"), "Selected restaurant marker SVG was not rendered");
  assert(!dom.includes("map-marker__detail"), "Restaurant map still renders larger detail popovers");
  assert(!dom.includes("mapkit-surface"), "Legacy MapKit surface is still mounted");
  assert(!dom.includes("map-preview"), "Legacy preview map branch is still mounted");
  assert(dom.includes("michelin-guide.svg"), "Michelin guide SVG icon is not rendered");

  const status = dom.match(/data-amap-status="([^"]+)"/)?.[1] ?? "unknown";
  const runtimeKey = existsSync(runtimeConfigPath)
    ? JSON.parse(readFileSync(runtimeConfigPath, "utf8")).key
    : "";
  const hasKey = Boolean(env.VITE_AMAP_KEY?.trim() || String(runtimeKey ?? "").trim());
  const liveAmapDom =
    /class="[^"]*amap-(maps|layer|layers|logo|copyright)[^"]*"/.test(dom) ||
    /<canvas\b/.test(dom);

  if (env.EXPECT_LIVE_AMAP === "1") {
    assert(hasKey, "EXPECT_LIVE_AMAP=1 requires an AMap key");
    assert(status === "ready", `Expected live AMap status ready, got ${status}`);
    assert(liveAmapDom, "Live AMap DOM nodes were not rendered");
    assert(dom.includes("map-marker"), "AMap markers were not rendered");
  }

  if (hasKey) {
    assert(status !== "missing-key", "AMap key was ignored by the app");
  } else {
    assert(
      dom.includes("amap-surface--missing-key"),
      "No-key runtime did not render the nonblank missing-key map surface",
    );
  }

  console.log(
    `AMap runtime verification passed: surface mounted, legacy maps absent, status=${status}, liveDom=${liveAmapDom}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
} finally {
  if (server) {
    server.kill("SIGTERM");
  }
}
