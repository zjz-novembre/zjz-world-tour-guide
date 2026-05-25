import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { cwd, env, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const viteBin = join(root, "node_modules", ".bin", "vite");
const sourcePayloadPath = join(root, "output", "sources", "michelin-guide-china.json");
const sourcePayload = existsSync(sourcePayloadPath)
  ? JSON.parse(readFileSync(sourcePayloadPath, "utf8"))
  : { cityCounts: { xiamen: 42, shanghai: 154, chengdu: 76, "hong-kong": 218 } };
const appSource = readFileSync(join(root, "src", "App.tsx"), "utf8");
const mapViewSource = readFileSync(join(root, "src", "components", "MapView.tsx"), "utf8");
const optionsSource = readFileSync(join(root, "src", "data", "options.ts"), "utf8");
const stylesSource = readFileSync(join(root, "src", "styles.css"), "utf8");
const indexSource = readFileSync(join(root, "index.html"), "utf8");
const serviceWorkerSource = readFileSync(join(root, "public", "sw.js"), "utf8");
const citySwitchSample = ["xiamen", "shanghai", "chengdu", "hong-kong", "macau"].reduce(
  (acc, city) => {
    if (sourcePayload.cityCounts[city]) acc[city] = sourcePayload.cityCounts[city];
    return acc;
  },
  {},
);
const cityLabels = {
  xiamen: "厦门",
  shanghai: "上海",
  chengdu: "成都",
  "hong-kong": "香港",
  macau: "澳门",
};
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

assert(appSource.includes('city: "shanghai"'), "Default city is not Shanghai in App.tsx");
assert(
  appSource.includes("navigator.geolocation.getCurrentPosition"),
  "App does not request browser geolocation on first open",
);
assert(
  appSource.includes("coords.heading") &&
    mapViewSource.includes("map-user-location__arrow") &&
    mapViewSource.includes("--user-heading"),
  "User GPS marker is not wired as a heading-aware direction arrow",
);
assert(
  stylesSource.includes(".map-user-location__arrow") &&
    stylesSource.includes("clip-path: polygon") &&
    stylesSource.includes("rotate(var(--user-heading"),
  "User GPS marker arrow styling is missing",
);
assert(
  stylesSource.includes(".map-marker__pin-icon--bib") &&
    stylesSource.includes("calc(var(--size-map-pin-bib-icon) * 0.9)") &&
    stylesSource.includes("transform: rotate(45deg) translate(0, -8%)") &&
    stylesSource.includes(".map-marker__pin-icon--selected") &&
    stylesSource.includes("transform: rotate(45deg) translate(5%, 10%)"),
  "Bib and selected marker icon optical sizing offsets are missing",
);
assert(indexSource.includes("%BASE_URL%favicon.svg"), "index.html does not point favicon to favicon.svg");
assert(serviceWorkerSource.includes("/favicon.svg"), "Service worker does not cache favicon.svg");
assert(
  optionsSource.includes("center: [116.4163734, 39.93925]"),
  "Beijing city center is not anchored to 胖妹面庄",
);
assert(
  optionsSource.includes("center: [104.0677419, 30.654443]"),
  "Chengdu city center is not anchored to 川莆酒楼",
);
assert(
  optionsSource.includes("center: [118.5938671, 24.9116056]"),
  "Quanzhou city center is not anchored to 德文虾仔面",
);
assert(
  mapViewSource.includes("listIsCollapsed") && mapViewSource.includes("stableListTop"),
  "Collapsed list state can still change the web map focus calculation",
);
assert(
  mapViewSource.includes("const RESTORED_MARKER_SCALE_KM = 2") &&
    mapViewSource.includes("const MIN_MARKER_SCALE = 0.7") &&
    stylesSource.includes("scale(var(--map-marker-scale))"),
  "Map pins are not scaled from 70% at the initial 14km scale back to full size at 2km",
);
assert(
  stylesSource.includes(".list-section--collapsed .restaurant-list") &&
    stylesSource.includes("display: none;"),
  "Collapsed restaurant list still renders an empty panel instead of only the bottom handle",
);

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
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2500),
      });
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
      const waiters = eventWaiters.get(method) ?? [];
      const timer = setTimeout(() => {
        const activeWaiters = eventWaiters.get(method) ?? [];
        eventWaiters.set(
          method,
          activeWaiters.filter((waiter) => waiter.resolve !== resolve),
        );
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);

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

async function waitForAmapStable(cdp, timeoutMs = 25000) {
  const startedAt = Date.now();
  let latest = null;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        status: document.querySelector(".amap-surface")?.getAttribute("data-amap-status"),
        hasWindowAmap: Boolean(window.AMap),
        liveAmapNodes: document
          .querySelector(".amap-surface")
          ?.querySelectorAll(".amap-maps, .amap-layer, .amap-layers, .amap-logo, .amap-copyright, canvas")
          .length ?? 0,
        markers: document.querySelectorAll(".map-marker").length
      }))()`,
      returnByValue: true,
    });

    latest = result.result.value;

    if (
      latest.status === "missing-key" ||
      latest.status === "failed" ||
      (latest.status === "ready" &&
        latest.hasWindowAmap &&
        latest.liveAmapNodes > 0 &&
        latest.markers > 0)
    ) {
      return latest;
    }

    await delay(500);
  }

  return latest;
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

let vite = null;
let chrome = null;
let userDataDir = null;

try {
  assert(chromeBin, "Chrome or Chromium is required for layout verification");
  assert(existsSync(viteBin), "Run npm install before layout verification");

  const debugPort = await getFreePort();
  const appUrl = env.APP_URL ?? `http://127.0.0.1:${await getFreePort()}/`;
  userDataDir = mkdtempSync(join(tmpdir(), "michelin-layout-"));

  if (!env.APP_URL) {
    const { port } = new URL(appUrl);
    vite = spawn(
      viteBin,
      ["--host", "127.0.0.1", "--port", port, "--strictPort"],
      {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }

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

  const loaded = cdp.waitForEvent("Page.loadEventFired", 10000);
  await cdp.send("Page.navigate", { url: appUrl });
  await loaded;
  await waitForAmapStable(cdp);

  const desktop = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const stage = document.querySelector(".content-shell")?.getBoundingClientRect();
      const map = document.querySelector(".map-section")?.getBoundingClientRect();
      const list = document.querySelector(".list-section")?.getBoundingClientRect();
      const chrome = document.querySelector(".chrome-layer")?.getBoundingClientRect();
      const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
      const filters = document.querySelector(".filters")?.getBoundingClientRect();
      const firstIconStyle = getComputedStyle(document.querySelector(".filter-slot--city .filter-control__icon"));
      const secondIconStyle = getComputedStyle(document.querySelector(".filter-slot--cost .filter-control__icon"));
      const starImage = document.querySelector(".filter-slot--level img.filter-control__image");
      const favicon = document.querySelector('link[rel="icon"]');
      const mapSurface = document.querySelector(".amap-surface");
      const mapStyle = getComputedStyle(mapSurface);
      const bibPin = document.querySelector(".map-marker--bib-gourmand .map-marker__pin");
      const bibPinIcon = document.querySelector(".map-marker--bib-gourmand .map-marker__pin-icon--bib");
      const bibPinRect = bibPin?.getBoundingClientRect();
      const bibPinIconRect = bibPinIcon?.getBoundingClientRect();
      const selectedPin = document.querySelector(".map-marker--selected .map-marker__pin");
      const selectedPinIcon = document.querySelector(".map-marker--selected .map-marker__pin-icon--selected");
      const liveAmapNodes = mapSurface
        ?.querySelectorAll(".amap-maps, .amap-layer, .amap-layers, .amap-logo, .amap-copyright, canvas")
        .length ?? 0;
      const amapStatus = mapSurface?.getAttribute("data-amap-status");
      const topbarStyle = getComputedStyle(document.querySelector(".topbar"));
      const filtersStyle = getComputedStyle(document.querySelector(".filters"));
      const ratio = stage && list ? list.width / stage.width : 0;
      const listGaps = stage && list
        ? {
          top: list.top - stage.top,
          right: stage.right - list.right,
          bottom: stage.bottom - list.bottom
        }
        : { top: 0, right: 0, bottom: 0 };
      const titleFilterGap = topbar && filters ? filters.top - topbar.bottom : -1;
      const cityAnchor = document.querySelector(".map-city-anchor")?.getBoundingClientRect();
      const cityAnchorX = cityAnchor ? cityAnchor.left + cityAnchor.width / 2 : 0;
      const expectedMapFocusX = stage && list ? (stage.left + list.left) / 2 : 0;

      return {
        documentTitle: document.title,
        brandText: document.querySelector(".brand__word")?.textContent?.trim() ?? "",
        defaultCityValue: document.querySelector(".filter-slot--city .filter-control__value")?.textContent?.trim() ?? "",
        faviconHref: favicon?.getAttribute("href") ?? "",
        viewport: { width: window.innerWidth, height: window.innerHeight },
        ratio,
        mapCoversStage: Boolean(stage && map)
          && map.left <= stage.left + 1
          && map.top <= stage.top + 1
          && map.right >= stage.right - 1
          && map.bottom >= stage.bottom - 1,
        floatingList: Boolean(stage && list)
          && ratio > 0.38
          && ratio < 0.42
          && listGaps.top > 0
          && listGaps.right > 0
          && listGaps.bottom > 0,
        floatingChrome: Boolean(stage && chrome && list)
          && chrome.left > stage.left
          && chrome.top > stage.top
          && chrome.right <= list.left - 1
          && titleFilterGap >= 0
          && titleFilterGap <= 14,
        listGaps,
        titleFilterGap,
        noHeaderFilterSeparator:
          topbarStyle.borderBottomWidth === "0px"
          && filtersStyle.borderTopWidth === "0px"
          && filtersStyle.borderBottomWidth === "0px",
        hasBrandMark: Boolean(document.querySelector(".brand__mark")),
        hasTopbarMeta: Boolean(document.querySelector(".topbar__meta")),
        amapMounted: Boolean(document.querySelector(".amap-surface")),
        amapStatus,
        mapScaleKm: mapSurface?.getAttribute("data-map-scale-km") ?? "",
        markerFullScaleKm: mapSurface?.getAttribute("data-marker-full-scale-km") ?? "",
        markerScale: mapSurface ? Number(getComputedStyle(mapSurface).getPropertyValue("--map-marker-scale")) : 0,
        mapZoom: window.AMap && mapSurface ? window.__michelinMapZoom ?? null : null,
        hasWindowAmap: Boolean(window.AMap),
        liveAmapNodes,
        realAmapMounted: Boolean(window.AMap) && liveAmapNodes > 0,
        readyWithoutPlaceholder: amapStatus === "ready" && mapStyle.backgroundImage === "none",
        storedMapMarkers: document.querySelectorAll(".map-marker").length,
        bibSvgPins: document.querySelectorAll('.map-marker__pin-icon--bib[src*="michelin-bib-gourmand-white.svg"]').length,
        bibPinBackground: bibPin ? getComputedStyle(bibPin).backgroundColor : "",
        bibIconCenterDeltaX: bibPinRect && bibPinIconRect
          ? (bibPinIconRect.left + bibPinIconRect.width / 2) - (bibPinRect.left + bibPinRect.width / 2)
          : null,
        bibPinIconLoaded: bibPinIcon instanceof HTMLImageElement
          && bibPinIcon.complete
          && bibPinIcon.naturalWidth > 0
          && bibPinIcon.getAttribute("src")?.includes("michelin-bib-gourmand-white.svg"),
        selectedSvgPins: document.querySelectorAll('.map-marker__pin-icon--selected[src*="restaurant-selected-white.svg"]').length,
        selectedPinBackground: selectedPin ? getComputedStyle(selectedPin).backgroundColor : "",
        selectedPinIconLoaded: selectedPinIcon instanceof HTMLImageElement
          && selectedPinIcon.complete
          && selectedPinIcon.naturalWidth > 0
          && selectedPinIcon.getAttribute("src")?.includes("restaurant-selected-white.svg"),
        cityAnchorX,
        expectedMapFocusX,
        cityFocusesLeftViewport: Boolean(stage && list && cityAnchor)
          && cityAnchorX < stage.left + stage.width * 0.5
          && Math.abs(cityAnchorX - expectedMapFocusX) < stage.width * 0.05,
        mapkitMounted: Boolean(document.querySelector(".mapkit-surface")),
        legacyPreviewMounted: Boolean(document.querySelector(".map-preview")),
        michelinStarIcon: Boolean(starImage?.getAttribute("src")?.includes("michelin-guide.svg")),
        redFilterIcons: firstIconStyle.color === secondIconStyle.color
          && firstIconStyle.color !== "rgb(161, 156, 148)"
      };
    })()`,
    returnByValue: true,
  });

  const desktopValue = desktop.result.value;
  assert(desktopValue.documentTitle === "Lite Michelin", `Document title is not Lite Michelin: ${desktopValue.documentTitle}`);
  assert(desktopValue.brandText === "MICHELIN", `Visible page brand is not MICHELIN: ${desktopValue.brandText}`);
  assert(desktopValue.defaultCityValue === "上海", `Default city is not Shanghai: ${desktopValue.defaultCityValue}`);
  assert(desktopValue.faviconHref.endsWith("/favicon.svg") || desktopValue.faviconHref === "./favicon.svg", `Favicon does not use favicon.svg: ${desktopValue.faviconHref}`);
  assert(desktopValue.viewport.width === 1440, `Expected 1440px desktop viewport, got ${desktopValue.viewport.width}`);
  assert(desktopValue.mapCoversStage, "Map is not the full-page base layer");
  assert(desktopValue.floatingList, `Restaurant list is not floating over the map with 40% width/gaps: ${JSON.stringify({ ratio: desktopValue.ratio, gaps: desktopValue.listGaps })}`);
  assert(desktopValue.floatingChrome, `Title and filters are not tight floating chrome: title/filter gap=${desktopValue.titleFilterGap}`);
  assert(desktopValue.noHeaderFilterSeparator, "Header/filter separator line is still visible");
  assert(!desktopValue.hasBrandMark, "Top-left circular M mark is still rendered");
  assert(!desktopValue.hasTopbarMeta, "Top-right stat counters are still rendered");
  assert(desktopValue.amapMounted, "AMap surface is not mounted");
  assert(desktopValue.amapStatus === "ready", `AMap did not reach ready status on desktop: ${desktopValue.amapStatus}`);
  assert(desktopValue.mapScaleKm === "14", `Map scale is not Shanghai-inner-ring span: ${desktopValue.mapScaleKm}`);
  assert(desktopValue.markerFullScaleKm === "2", `Map marker full scale is not pinned to 2km: ${desktopValue.markerFullScaleKm}`);
  assert(
    desktopValue.markerScale >= 0.69 && desktopValue.markerScale <= 0.71,
    `Initial map pin scale is not 70% at 14km: ${JSON.stringify(desktopValue)}`,
  );
  assert(desktopValue.realAmapMounted, `Live AMap DOM did not mount on desktop: ${JSON.stringify({ hasWindowAmap: desktopValue.hasWindowAmap, liveAmapNodes: desktopValue.liveAmapNodes })}`);
  assert(desktopValue.readyWithoutPlaceholder, "Ready AMap is still showing the CSS placeholder background");
  assert(desktopValue.storedMapMarkers > 0, `Expected stored AMap markers after ready, got ${desktopValue.storedMapMarkers}`);
  assert(desktopValue.bibSvgPins > 0, `Bib Gourmand SVG pins did not render on the map: ${JSON.stringify(desktopValue)}`);
  assert(desktopValue.bibPinBackground === "rgb(162, 121, 61)", `Bib Gourmand waterdrop pin is not Bib yellow: ${JSON.stringify(desktopValue)}`);
  assert(Math.abs(desktopValue.bibIconCenterDeltaX) < 1, `Bib Gourmand SVG is not horizontally centered in the waterdrop pin: ${JSON.stringify(desktopValue)}`);
  assert(desktopValue.bibPinIconLoaded, `Bib Gourmand white SVG icon is not loaded inside the waterdrop pin: ${JSON.stringify(desktopValue)}`);
  assert(desktopValue.selectedSvgPins > 0, `Selected SVG pins did not render on the map: ${JSON.stringify(desktopValue)}`);
  assert(desktopValue.selectedPinBackground === "rgb(116, 112, 106)", `Selected waterdrop pin is not selected gray: ${JSON.stringify(desktopValue)}`);
  assert(desktopValue.selectedPinIconLoaded, `Selected white SVG icon is not loaded inside the waterdrop pin: ${JSON.stringify(desktopValue)}`);
  assert(
    desktopValue.cityFocusesLeftViewport,
    `City center is not centered in the left 60% viewport: ${JSON.stringify({
      cityAnchorX: desktopValue.cityAnchorX,
      expectedMapFocusX: desktopValue.expectedMapFocusX,
    })}`,
  );
  assert(!desktopValue.mapkitMounted, "Legacy MapKit surface is still mounted");
  assert(!desktopValue.legacyPreviewMounted, "Legacy preview map is still mounted");
  assert(desktopValue.michelinStarIcon, "Star filter does not use michelin-guide.svg");
  assert(desktopValue.redFilterIcons, "City/cost filter icons are not using the Michelin color");

  let tagZoomBand = "pin";
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 500,
      y: 500,
      deltaX: 0,
      deltaY: -240,
    });
    await delay(180);

    const band = await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(".amap-surface")?.getAttribute("data-amap-zoom-band") ?? "missing"`,
      returnByValue: true,
    });
    tagZoomBand = band.result.value;
    if (tagZoomBand === "tag") {
      await delay(450);
      const stableBand = await cdp.send("Runtime.evaluate", {
        expression: `document.querySelector(".amap-surface")?.getAttribute("data-amap-zoom-band") ?? "missing"`,
        returnByValue: true,
      });
      tagZoomBand = stableBand.result.value;
      if (tagZoomBand === "tag") break;
    }
  }
  assert(tagZoomBand === "tag", `Map did not reach tag-only zoom before click: ${tagZoomBand}`);

  const mapTagInteraction = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const zoomBeforeClick = document.querySelector(".amap-surface")?.getAttribute("data-amap-zoom-band");

      const firstRowNameBeforeClick = document.querySelector(".restaurant-row:first-child .restaurant-row__name")?.textContent?.trim() ?? "";
      const rowNames = [...document.querySelectorAll(".restaurant-row__name")]
        .map((row) => row.textContent?.trim() ?? "");
      const lowerListNames = new Set(rowNames.slice(Math.min(30, Math.max(rowNames.length - 1, 0))));
      const tags = [...document.querySelectorAll(".map-marker__tag")];
      const firstTag = tags.find((tag) => lowerListNames.has(tag.querySelector(".map-marker__tag-name")?.textContent?.trim() ?? ""))
        ?? tags.find((tag) => tag.querySelector(".map-marker__tag-name")?.textContent?.trim() !== firstRowNameBeforeClick)
        ?? document.querySelector(".map-marker__tag");
      const anchorBeforeClick = document.querySelector(".map-city-anchor")?.getBoundingClientRect();
      const collapsedWidth = firstTag?.getBoundingClientRect().width ?? 0;
      const targetTagName = firstTag?.querySelector(".map-marker__tag-name")?.textContent?.trim() ?? "";
      firstTag?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const activeTag = document.querySelector(".map-marker--active .map-marker__tag");
        if (
          activeTag &&
          activeTag.getBoundingClientRect().width > collapsedWidth + 24 &&
          getComputedStyle(activeTag).opacity === "1"
        ) {
          break;
        }
        await wait(180);
      }

      for (let attempt = 0; attempt < 24; attempt += 1) {
        const listBody = document.querySelector(".restaurant-list__body");
        const activeRow = document.querySelector(".restaurant-row--active");
        if (listBody && activeRow) {
          const rowTopDelta = activeRow.getBoundingClientRect().top - listBody.getBoundingClientRect().top;
          if (Math.abs(rowTopDelta) <= 8 || listBody.scrollTop > 0) break;
        }
        await wait(120);
      }

      const activeRow = document.querySelector(".restaurant-row--active");
      const activeTag = document.querySelector(".map-marker--active .map-marker__tag");
      const activeMeta = document.querySelector(".map-marker--active .map-marker__tag-meta");
      const activeDishes = document.querySelector(".map-marker--active .map-marker__tag-dishes");
      const activeMarkerName = document.querySelector(".map-marker--active .map-marker__tag-name")?.textContent?.trim() ?? "";
      const activeRowName = activeRow?.querySelector(".restaurant-row__name")?.textContent?.trim() ?? "";
      const activeMarkers = document.querySelectorAll(".map-marker--active").length;
      const detailPopovers = document.querySelectorAll(".map-marker__detail").length;
      const expandedWidth = activeTag?.getBoundingClientRect().width ?? 0;
      const activeMetaDisplay = activeMeta ? getComputedStyle(activeMeta).display : "none";
      const activeDishesDisplay = activeDishes ? getComputedStyle(activeDishes).display : "none";
      const activeDishesText = activeDishes?.textContent?.trim() ?? "";
      const zoomAfterFirstClick = document.querySelector(".amap-surface")?.getAttribute("data-amap-zoom-band");
      const tagOpacityAfterFirstClick = firstTag ? getComputedStyle(firstTag).opacity : "0";
      const anchorAfterClick = document.querySelector(".map-city-anchor")?.getBoundingClientRect();
      const firstRowName = document.querySelector(".restaurant-row:first-child .restaurant-row__name")?.textContent?.trim() ?? "";
      const activeMarkerWrapper = activeTag?.closest(".amap-marker");
      const activeMarkerWrapperZIndex = activeMarkerWrapper ? getComputedStyle(activeMarkerWrapper).zIndex : "";
      const listBody = document.querySelector(".restaurant-list__body");
      const listBodyRect = listBody?.getBoundingClientRect();
      const activeRowRect = activeRow?.getBoundingClientRect();
      const activeRowTopDelta = listBodyRect && activeRowRect ? activeRowRect.top - listBodyRect.top : null;
      const listScrollTop = listBody?.scrollTop ?? 0;

      activeTag?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (document.querySelectorAll(".map-marker--active").length === 0) break;
        await wait(120);
      }
      const activeMarkersAfterSecondClick = document.querySelectorAll(".map-marker--active").length;
      const activeRowsAfterSecondClick = document.querySelectorAll(".restaurant-row--active").length;

      firstTag?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (document.querySelectorAll(".map-marker--active").length === 1) break;
        await wait(120);
      }

      document.querySelector(".amap-surface")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (document.querySelectorAll(".map-marker--active").length === 0) break;
        await wait(120);
      }

      return {
        zoomBeforeClick,
        zoomAfterFirstClick,
        anchorBeforeClick: anchorBeforeClick
          ? { x: anchorBeforeClick.left + anchorBeforeClick.width / 2, y: anchorBeforeClick.top + anchorBeforeClick.height / 2 }
          : null,
        anchorAfterClick: anchorAfterClick
          ? { x: anchorAfterClick.left + anchorAfterClick.width / 2, y: anchorAfterClick.top + anchorAfterClick.height / 2 }
          : null,
        tagCount: document.querySelectorAll(".map-marker__tag").length,
        tagOpacityAfterFirstClick,
        activeMarkers,
        detailPopovers,
        collapsedWidth,
        expandedWidth,
        activeMetaDisplay,
        activeDishesDisplay,
        activeDishesText,
        activeMarkerName,
        activeRowName,
        firstRowNameBeforeClick,
        firstRowName,
        targetTagName,
        activeRowTopDelta,
        listScrollTop,
        activeMarkerWrapperZIndex,
        activeMarkersAfterSecondClick,
        activeRowsAfterSecondClick,
        activeMarkersAfterMapClick: document.querySelectorAll(".map-marker--active").length,
        activeRowsAfterMapClick: document.querySelectorAll(".restaurant-row--active").length
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const mapTagValue = mapTagInteraction.result.value;
  assert(mapTagValue.zoomBeforeClick === "tag", `Map was not in tag-only state before click: ${JSON.stringify(mapTagValue)}`);
  assert(
    mapTagValue.anchorBeforeClick &&
      mapTagValue.anchorAfterClick &&
      Math.abs(mapTagValue.anchorBeforeClick.x - mapTagValue.anchorAfterClick.x) <= 2 &&
      Math.abs(mapTagValue.anchorBeforeClick.y - mapTagValue.anchorAfterClick.y) <= 2,
    `Clicking a restaurant tag moved the map instead of only expanding the tag: ${JSON.stringify(mapTagValue)}`,
  );
  assert(mapTagValue.tagCount > 0, "Restaurant map tags are missing");
  assert(mapTagValue.tagOpacityAfterFirstClick === "1", `Restaurant map tags are not visible after zoom: ${JSON.stringify(mapTagValue)}`);
  assert(mapTagValue.activeMarkers === 1, `Clicking a restaurant tag did not select exactly one marker: ${JSON.stringify(mapTagValue)}`);
  assert(mapTagValue.detailPopovers === 0, `Clicking a restaurant tag rendered a larger detail popup: ${JSON.stringify(mapTagValue)}`);
  assert(mapTagValue.expandedWidth > mapTagValue.collapsedWidth + 24, `Clicking a restaurant tag did not expand the tag: ${JSON.stringify(mapTagValue)}`);
  assert(mapTagValue.activeMetaDisplay !== "none", `Expanded restaurant tag did not show cost/star detail: ${JSON.stringify(mapTagValue)}`);
  assert(mapTagValue.activeDishesDisplay !== "none" && mapTagValue.activeDishesText, `Expanded restaurant tag did not show dishes: ${JSON.stringify(mapTagValue)}`);
  assert(mapTagValue.activeMarkerName === mapTagValue.activeRowName, `Map marker and list selection are out of sync: ${JSON.stringify(mapTagValue)}`);
  assert(mapTagValue.activeMarkerName === mapTagValue.targetTagName, `Clicked map marker did not become the active marker: ${JSON.stringify(mapTagValue)}`);
  assert(mapTagValue.firstRowName === mapTagValue.firstRowNameBeforeClick, `Map selection reordered the restaurant list instead of preserving rank order: ${JSON.stringify(mapTagValue)}`);
  assert(
    mapTagValue.listScrollTop > 0 && Math.abs(mapTagValue.activeRowTopDelta) <= 24,
    `Clicked map marker did not scroll the selected restaurant into view at the top of the list: ${JSON.stringify(mapTagValue)}`,
  );
  assert(
    Number.parseInt(mapTagValue.activeMarkerWrapperZIndex, 10) >= 10000,
    `Expanded map marker tag is not in the foreground stacking layer: ${JSON.stringify(mapTagValue)}`,
  );
  assert(
    mapTagValue.activeMarkersAfterSecondClick === 0 && mapTagValue.activeRowsAfterSecondClick === 0,
    `Second click on an expanded tag did not collapse selection: ${JSON.stringify(mapTagValue)}`,
  );
  assert(
    mapTagValue.activeMarkersAfterMapClick === 0 && mapTagValue.activeRowsAfterMapClick === 0,
    `Clicking map background did not collapse selection: ${JSON.stringify(mapTagValue)}`,
  );

  const citySwitches = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const expected = ${JSON.stringify(citySwitchSample)};
      const labels = ${JSON.stringify(cityLabels)};
      const results = {};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const selectCity = async (city) => {
        const button = document.querySelector(".filter-slot--city .filter-control__button");
        button?.click();
        await wait(20);
        const option = Array.from(document.querySelectorAll(".filter-slot--city .filter-control__option"))
          .find((element) => element.textContent.trim() === labels[city]);
        option?.click();
        await wait(20);
      };

      for (const [city, expectedRows] of Object.entries(expected)) {
        await selectCity(city);

        for (let attempt = 0; attempt < 40; attempt += 1) {
          const rowCount = document.querySelectorAll(".restaurant-row").length;
          const markerCount = document.querySelectorAll(".map-marker").length;
          const status = document
            .querySelector(".amap-surface")
            ?.getAttribute("data-amap-status");

          const liveAmapNodes = document
            .querySelector(".amap-surface")
            ?.querySelectorAll(".amap-maps, .amap-layer, .amap-layers, .amap-logo, .amap-copyright, canvas")
            .length ?? 0;

          if (rowCount === expectedRows && status === "ready" && markerCount > 0 && liveAmapNodes > 0) {
            break;
          }

          await wait(250);
        }

        results[city] = {
          label: document
            .querySelector(".filter-slot--city .filter-control__value")
            ?.textContent
            ?.trim(),
          rows: document.querySelectorAll(".restaurant-row").length,
          markers: document.querySelectorAll(".map-marker").length,
          liveAmapNodes: document
            .querySelector(".amap-surface")
            ?.querySelectorAll(".amap-maps, .amap-layer, .amap-layers, .amap-logo, .amap-copyright, canvas")
            .length ?? 0,
          status: document
            .querySelector(".amap-surface")
            ?.getAttribute("data-amap-status"),
          mapCity: document
            .querySelector(".amap-surface")
            ?.getAttribute("data-map-city"),
          mapScaleKm: document
            .querySelector(".amap-surface")
            ?.getAttribute("data-map-scale-km"),
          anchorCity: document
            .querySelector(".map-city-anchor")
            ?.getAttribute("data-city")
        };
      }

      return results;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const citySwitchValue = citySwitches.result.value;
  const expectedCityRows = citySwitchSample;

  for (const [city, expectedRows] of Object.entries(expectedCityRows)) {
    const observed = citySwitchValue[city];
    assert(observed?.rows === expectedRows, `${city} rows mismatch: ${JSON.stringify(observed)}`);
    assert(observed.status === "ready", `${city} AMap did not stay ready: ${JSON.stringify(observed)}`);
    assert(observed.mapCity === city, `${city} map surface did not switch city: ${JSON.stringify(observed)}`);
    assert(observed.mapScaleKm === "14", `${city} map scale does not use the shared city-center span: ${JSON.stringify(observed)}`);
    assert(observed.anchorCity === city, `${city} map anchor did not switch city: ${JSON.stringify(observed)}`);
    assert(observed.liveAmapNodes > 0, `${city} live AMap DOM is missing: ${JSON.stringify(observed)}`);
    assert(observed.markers > 0, `${city} markers missing after AMap ready: ${JSON.stringify(observed)}`);
  }

  await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelector(".filter-slot--city .filter-control__button")?.click();
      await wait(20);
      Array.from(document.querySelectorAll(".filter-slot--city .filter-control__option"))
        .find((element) => element.textContent.trim() === "厦门")
        ?.click();
    })()`,
    awaitPromise: true,
  });
  await waitForAmapStable(cdp);

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 500,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForAmapStable(cdp);

  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const controls = Array.from(document.querySelectorAll(".filter-control"));
      const stage = document.querySelector(".content-shell")?.getBoundingClientRect();
      const list = document.querySelector(".list-section")?.getBoundingClientRect();
      const chrome = document.querySelector(".chrome-layer")?.getBoundingClientRect();
      const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
      const filters = document.querySelector(".filters")?.getBoundingClientRect();
      const mapSurface = document.querySelector(".amap-surface");
      const firstRow = document.querySelector(".restaurant-row");
      const mobileCard = firstRow?.querySelector(".restaurant-row__mobile-card");
      const mobileName = firstRow?.querySelector(".restaurant-row__mobile-name");
      const mobileCost = firstRow?.querySelector(".restaurant-row__mobile-cost");
      const mobileLevel = firstRow?.querySelector(".restaurant-row__mobile-level");
      const mobileDishes = firstRow?.querySelector(".restaurant-row__mobile-dishes");
      const mobileLink = firstRow?.querySelector(".restaurant-row__mobile-link");
      const mobileLinkIcon = firstRow?.querySelector(".restaurant-row__mobile-link svg");
      const desktopNameCell = firstRow?.querySelector(":scope > .restaurant-row__name-cell");
      const mapStyle = getComputedStyle(mapSurface);
      const liveAmapNodes = mapSurface
        ?.querySelectorAll(".amap-maps, .amap-layer, .amap-layers, .amap-logo, .amap-copyright, canvas")
        .length ?? 0;
      const amapStatus = mapSurface?.getAttribute("data-amap-status");
      const bounds = controls.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
          height: rect.height
        };
      });
      const shell = document.querySelector(".filters")?.getBoundingClientRect();
      const firstFilterLabelStyle = getComputedStyle(document.querySelector(".filter-slot--city .filter-control__label"));
      const firstFilterValueStyle = getComputedStyle(document.querySelector(".filter-slot--city .filter-control__value"));
      const tops = bounds.map((bound) => bound.top);
      const titleFilterGap = topbar && filters ? filters.top - topbar.bottom : -1;
      const listGaps = stage && list
        ? {
          left: list.left - stage.left,
          right: stage.right - list.right,
          bottom: stage.bottom - list.bottom
        }
        : { left: 0, right: 0, bottom: 0 };
      const sameRow = bounds.length === 3
        && Math.max(...tops) - Math.min(...tops) < 2
        && bounds.every((bound) => bound.width > 0)
        && bounds[0].right <= bounds[1].left
        && bounds[1].right <= bounds[2].left
        && Boolean(shell)
        && bounds[2].right <= shell.right + 1;

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        bounds,
        filterHeight: Math.round(bounds[0]?.height ?? 0),
        filterLabelFontSize: firstFilterLabelStyle.fontSize,
        filterValueFontSize: firstFilterValueStyle.fontSize,
        sameRow,
        floatingChrome: Boolean(stage && chrome)
          && chrome.left > stage.left
          && chrome.top > stage.top
          && titleFilterGap >= 0
          && titleFilterGap <= 14,
        floatingList: Boolean(stage && list)
          && listGaps.left > 0
          && listGaps.right > 0
          && listGaps.bottom > 0,
        listGaps,
        titleFilterGap,
        amapMounted: Boolean(document.querySelector(".amap-surface")),
        amapStatus,
        hasWindowAmap: Boolean(window.AMap),
        liveAmapNodes,
        realAmapMounted: Boolean(window.AMap) && liveAmapNodes > 0,
        readyWithoutPlaceholder: amapStatus === "ready" && mapStyle.backgroundImage === "none",
        storedMapMarkers: document.querySelectorAll(".map-marker").length,
        michelinStarIcon: Boolean(document.querySelector(".filter-slot--level img.filter-control__image")?.getAttribute("src")?.includes("michelin-guide.svg")),
        visibleFilterIcons: Array.from(document.querySelectorAll(".filter-control__icon")).every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }),
        mobileCardDisplay: mobileCard ? getComputedStyle(mobileCard).display : "missing",
        desktopNameCellDisplay: desktopNameCell ? getComputedStyle(desktopNameCell).display : "missing",
        mobileRowCostText: mobileCost?.textContent?.trim() ?? "",
        mobileRowLevelText: mobileLevel?.textContent?.trim() ?? "",
        mobileRowDishesText: mobileDishes?.textContent?.trim() ?? "",
        mobileNameLeft: mobileName?.getBoundingClientRect().left ?? 0,
        mobileNameTop: Math.round(mobileName?.getBoundingClientRect().top ?? 0),
        mobileNameBottom: Math.round(mobileName?.getBoundingClientRect().bottom ?? 0),
        mobileCostLeft: mobileCost?.getBoundingClientRect().left ?? 0,
        mobileCostTop: Math.round(mobileCost?.getBoundingClientRect().top ?? 0),
        mobileCostBottom: Math.round(mobileCost?.getBoundingClientRect().bottom ?? 0),
        mobileLevelLeft: mobileLevel?.getBoundingClientRect().left ?? 0,
        mobileLevelTop: Math.round(mobileLevel?.getBoundingClientRect().top ?? 0),
        mobileLevelBottom: Math.round(mobileLevel?.getBoundingClientRect().bottom ?? 0),
        mobileLinkLeft: mobileLink?.getBoundingClientRect().left ?? 0,
        mobileLinkTop: Math.round(mobileLink?.getBoundingClientRect().top ?? 0),
        mobileLinkBottom: Math.round(mobileLink?.getBoundingClientRect().bottom ?? 0),
        mobileLinkIconBottom: Math.round(mobileLinkIcon?.getBoundingClientRect().bottom ?? 0),
        mobileDishesLeft: mobileDishes?.getBoundingClientRect().left ?? 0,
        mobileDishesTop: Math.round(mobileDishes?.getBoundingClientRect().top ?? 0),
        mobileDishesGap: Math.round((mobileDishes?.getBoundingClientRect().top ?? 0) - (mobileName?.getBoundingClientRect().bottom ?? 0)),
        mapkitMounted: Boolean(document.querySelector(".mapkit-surface")),
        legacyPreviewMounted: Boolean(document.querySelector(".map-preview")),
        amapStatus
      };
    })()`,
    returnByValue: true,
  });

  const value = result.result.value;
  assert(value.viewport.width === 500, `Expected 500px app viewport, got ${value.viewport.width}`);
  assert(value.bounds.length === 3, `Expected 3 filters, got ${value.bounds.length}`);
  assert(value.sameRow, `Filters did not stay on one row: ${JSON.stringify(value.bounds)}`);
  assert(value.floatingChrome, `Mobile title and filters are not tight floating chrome: title/filter gap=${value.titleFilterGap}`);
  assert(value.floatingList, `Mobile list is not floating with side/bottom gaps: ${JSON.stringify(value.listGaps)}`);
  assert(value.amapMounted, "AMap surface is not mounted");
  assert(value.amapStatus === "ready", `AMap did not reach ready status on mobile: ${value.amapStatus}`);
  assert(value.realAmapMounted, `Live AMap DOM did not mount on mobile: ${JSON.stringify({ hasWindowAmap: value.hasWindowAmap, liveAmapNodes: value.liveAmapNodes })}`);
  assert(value.readyWithoutPlaceholder, "Ready AMap is still showing the CSS placeholder background on mobile");
  assert(value.storedMapMarkers > 0, `Expected stored AMap markers after ready on mobile, got ${value.storedMapMarkers}`);
  assert(!value.mapkitMounted, "Legacy MapKit surface is still mounted");
  assert(!value.legacyPreviewMounted, "Legacy preview map is still mounted");
  assert(value.michelinStarIcon, "Mobile star filter does not use michelin-guide.svg");
  assert(value.visibleFilterIcons, "Mobile filter icons are hidden");
  assert(
    value.mobileCardDisplay === "grid" &&
      value.desktopNameCellDisplay === "none" &&
      value.mobileRowCostText &&
      value.mobileRowLevelText &&
      value.mobileRowDishesText,
    `Mobile restaurant card does not replace the desktop table row correctly: ${JSON.stringify(value)}`,
  );
  assert(
    Math.abs(value.mobileDishesLeft - value.mobileNameLeft) < 2 &&
      Math.abs(value.mobileNameBottom - value.mobileCostBottom) <= 3 &&
      Math.abs(value.mobileNameBottom - value.mobileLevelBottom) <= 3 &&
      Math.abs(value.mobileNameBottom - value.mobileLinkBottom) <= 3 &&
      Math.abs(value.mobileNameBottom - value.mobileLinkIconBottom) <= 3 &&
      value.mobileDishesGap >= 1 &&
      value.mobileDishesGap <= 6 &&
      value.mobileNameLeft < value.mobileCostLeft &&
      value.mobileCostLeft < value.mobileLevelLeft &&
      value.mobileLevelLeft < value.mobileLinkLeft,
    `Mobile restaurant card baseline or dish gap is wrong: ${JSON.stringify({
      name: value.mobileNameLeft,
      cost: value.mobileCostLeft,
      level: value.mobileLevelLeft,
      link: value.mobileLinkLeft,
      tops: {
        name: value.mobileNameTop,
        cost: value.mobileCostTop,
        level: value.mobileLevelTop,
        link: value.mobileLinkTop,
      },
      bottoms: {
        name: value.mobileNameBottom,
        cost: value.mobileCostBottom,
        level: value.mobileLevelBottom,
        link: value.mobileLinkBottom,
        linkIcon: value.mobileLinkIconBottom,
      },
      dishes: value.mobileDishesLeft,
      dishGap: value.mobileDishesGap,
    })}`,
  );

  const collapsedListMap = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      await wait(550);
      const anchorBefore = document.querySelector(".map-city-anchor")?.getBoundingClientRect();
      const toggle = document.querySelector(".restaurant-list-toggle");
      const listBefore = document.querySelector(".list-section")?.getBoundingClientRect();
      toggle?.click();
      await wait(450);
      const anchorAfter = document.querySelector(".map-city-anchor")?.getBoundingClientRect();
      const listAfter = document.querySelector(".list-section")?.getBoundingClientRect();
      const toggleAfter = document.querySelector(".restaurant-list-toggle")?.getBoundingClientRect();
      const restaurantListAfter = document.querySelector(".restaurant-list");

      return {
        collapsed: document.querySelector(".list-section")?.classList.contains("list-section--collapsed") ?? false,
        anchorBefore: anchorBefore
          ? { x: anchorBefore.left + anchorBefore.width / 2, y: anchorBefore.top + anchorBefore.height / 2 }
          : null,
        anchorAfter: anchorAfter
          ? { x: anchorAfter.left + anchorAfter.width / 2, y: anchorAfter.top + anchorAfter.height / 2 }
          : null,
        listHeightBefore: listBefore?.height ?? 0,
        listHeightAfter: listAfter?.height ?? 0,
        restaurantListDisplay: restaurantListAfter ? getComputedStyle(restaurantListAfter).display : "missing",
        toggleVisible: Boolean(toggleAfter && toggleAfter.width > 0 && toggleAfter.height > 0)
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const collapsedListMapValue = collapsedListMap.result.value;
  assert(
    collapsedListMapValue.collapsed &&
      collapsedListMapValue.anchorBefore &&
      collapsedListMapValue.anchorAfter &&
      Math.abs(collapsedListMapValue.anchorBefore.x - collapsedListMapValue.anchorAfter.x) <= 2 &&
      Math.abs(collapsedListMapValue.anchorBefore.y - collapsedListMapValue.anchorAfter.y) <= 2 &&
      collapsedListMapValue.listHeightAfter <= 1 &&
      collapsedListMapValue.restaurantListDisplay === "none" &&
      collapsedListMapValue.toggleVisible,
    `Collapsing the list moved the map or left an empty list panel instead of only the handle: ${JSON.stringify(collapsedListMapValue)}`,
  );
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector(".restaurant-list-toggle")?.click()`,
  });
  await delay(450);

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 844,
    height: 390,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelector(".filter-slot--city .filter-control__button")?.click();
      await wait(20);
      Array.from(document.querySelectorAll(".filter-slot--city .filter-control__option"))
        .find((element) => element.textContent.trim() === "成都")
        ?.click();
    })()`,
    awaitPromise: true,
  });
  await waitForAmapStable(cdp);

  const landscape = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const controls = Array.from(document.querySelectorAll(".filter-control"));
      const bounds = controls.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
          height: rect.height
        };
      });
      const tops = bounds.map((bound) => bound.top);
      const shell = document.querySelector(".filters")?.getBoundingClientRect();
      const stage = document.querySelector(".content-shell")?.getBoundingClientRect();
      const list = document.querySelector(".list-section")?.getBoundingClientRect();
      const chrome = document.querySelector(".chrome-layer")?.getBoundingClientRect();
      const mapSurface = document.querySelector(".amap-surface");
      const cityAnchor = document.querySelector(".map-city-anchor")?.getBoundingClientRect();
      const cityAnchorCenter = cityAnchor
        ? { x: cityAnchor.left + cityAnchor.width / 2, y: cityAnchor.top + cityAnchor.height / 2 }
        : { x: 0, y: 0 };
      const visibleCenter = stage && list && chrome
        ? { x: stage.left + (list.left - stage.left) / 2, y: chrome.bottom + (stage.bottom - chrome.bottom) / 2 }
        : stage
          ? { x: stage.left + stage.width / 2, y: stage.top + stage.height / 2 }
          : { x: 0, y: 0 };
      const firstRow = document.querySelector(".restaurant-row");
      const mobileCard = firstRow?.querySelector(".restaurant-row__mobile-card");
      const mobileName = firstRow?.querySelector(".restaurant-row__mobile-name");
      const mobileCost = firstRow?.querySelector(".restaurant-row__mobile-cost");
      const mobileLevel = firstRow?.querySelector(".restaurant-row__mobile-level");
      const mobileDishes = firstRow?.querySelector(".restaurant-row__mobile-dishes");
      const mobileLink = firstRow?.querySelector(".restaurant-row__mobile-link");
      const mobileLinkIcon = firstRow?.querySelector(".restaurant-row__mobile-link svg");
      const firstFilterLabelStyle = getComputedStyle(document.querySelector(".filter-slot--city .filter-control__label"));
      const firstFilterValueStyle = getComputedStyle(document.querySelector(".filter-slot--city .filter-control__value"));

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        bounds,
        filterHeight: Math.round(bounds[0]?.height ?? 0),
        filterLabelFontSize: firstFilterLabelStyle.fontSize,
        filterValueFontSize: firstFilterValueStyle.fontSize,
        sameRow: bounds.length === 3
          && Math.max(...tops) - Math.min(...tops) < 2
          && bounds.every((bound) => bound.width > 0)
          && bounds[0].right <= bounds[1].left
          && bounds[1].right <= bounds[2].left
          && Boolean(shell)
          && bounds[2].right <= shell.right + 1,
        mapCity: mapSurface?.getAttribute("data-map-city"),
        anchorCity: document.querySelector(".map-city-anchor")?.getAttribute("data-city"),
        cityAnchorCenter,
        visibleCenter,
        listGaps: stage && list ? {
          top: list.top - stage.top,
          right: stage.right - list.right,
          bottom: stage.bottom - list.bottom,
          widthRatio: list.width / stage.width
        } : null,
        chengduCentered:
          Boolean(stage && cityAnchor)
          && Math.abs(cityAnchorCenter.x - visibleCenter.x) < stage.width * 0.05
          && Math.abs(cityAnchorCenter.y - visibleCenter.y) < stage.height * 0.08,
        mobileCardDisplay: mobileCard ? getComputedStyle(mobileCard).display : "missing",
        mobileRowCostText: mobileCost?.textContent?.trim() ?? "",
        mobileRowLevelText: mobileLevel?.textContent?.trim() ?? "",
        mobileDishesLeft: mobileDishes?.getBoundingClientRect().left ?? 0,
        mobileDishesGap: Math.round((mobileDishes?.getBoundingClientRect().top ?? 0) - (mobileName?.getBoundingClientRect().bottom ?? 0)),
        mobileNameLeft: mobileName?.getBoundingClientRect().left ?? 0,
        mobileNameBottom: Math.round(mobileName?.getBoundingClientRect().bottom ?? 0),
        mobileCostLeft: mobileCost?.getBoundingClientRect().left ?? 0,
        mobileCostBottom: Math.round(mobileCost?.getBoundingClientRect().bottom ?? 0),
        mobileLevelLeft: mobileLevel?.getBoundingClientRect().left ?? 0,
        mobileLevelBottom: Math.round(mobileLevel?.getBoundingClientRect().bottom ?? 0),
        mobileLinkLeft: mobileLink?.getBoundingClientRect().left ?? 0,
        mobileLinkBottom: Math.round(mobileLink?.getBoundingClientRect().bottom ?? 0),
        mobileLinkIconBottom: Math.round(mobileLinkIcon?.getBoundingClientRect().bottom ?? 0),
        rows: document.querySelectorAll(".restaurant-row").length,
        markers: document.querySelectorAll(".map-marker").length
      };
    })()`,
    returnByValue: true,
  });

  const landscapeValue = landscape.result.value;
  assert(landscapeValue.viewport.width === 844, `Expected 844px landscape viewport, got ${landscapeValue.viewport.width}`);
  assert(landscapeValue.sameRow, `Landscape mobile filters did not stay on one row: ${JSON.stringify(landscapeValue.bounds)}`);
  assert(
    Math.abs(landscapeValue.filterHeight - value.filterHeight) <= 1 &&
      landscapeValue.filterLabelFontSize === value.filterLabelFontSize &&
      landscapeValue.filterValueFontSize === value.filterValueFontSize,
    `Landscape mobile filter size/fonts differ from portrait: ${JSON.stringify({
      portrait: {
        height: value.filterHeight,
        label: value.filterLabelFontSize,
        value: value.filterValueFontSize,
      },
      landscape: {
        height: landscapeValue.filterHeight,
        label: landscapeValue.filterLabelFontSize,
        value: landscapeValue.filterValueFontSize,
      },
    })}`,
  );
  assert(
    landscapeValue.mapCity === "chengdu" &&
      landscapeValue.anchorCity === "chengdu" &&
      landscapeValue.chengduCentered,
    `Chengdu is not centered in mobile landscape first view: ${JSON.stringify({
      mapCity: landscapeValue.mapCity,
	      anchorCity: landscapeValue.anchorCity,
	      cityAnchorCenter: landscapeValue.cityAnchorCenter,
	      visibleCenter: landscapeValue.visibleCenter,
	      listGaps: landscapeValue.listGaps,
	    })}`,
	  );
	  assert(
	    landscapeValue.mobileCardDisplay === "grid" &&
	      landscapeValue.mobileRowCostText &&
	      landscapeValue.mobileRowLevelText &&
	      Math.abs(landscapeValue.mobileDishesLeft - landscapeValue.mobileNameLeft) < 2 &&
      Math.abs(landscapeValue.mobileNameBottom - landscapeValue.mobileCostBottom) <= 3 &&
      Math.abs(landscapeValue.mobileNameBottom - landscapeValue.mobileLevelBottom) <= 3 &&
      Math.abs(landscapeValue.mobileNameBottom - landscapeValue.mobileLinkBottom) <= 3 &&
      Math.abs(landscapeValue.mobileNameBottom - landscapeValue.mobileLinkIconBottom) <= 3 &&
      landscapeValue.mobileDishesGap >= 1 &&
      landscapeValue.mobileDishesGap <= 6 &&
	      landscapeValue.mobileNameLeft < landscapeValue.mobileCostLeft &&
	      landscapeValue.mobileCostLeft < landscapeValue.mobileLevelLeft &&
	      landscapeValue.mobileLevelLeft < landscapeValue.mobileLinkLeft,
	    `Landscape mobile restaurant card baseline or dish gap is wrong: ${JSON.stringify(landscapeValue)}`,
	  );

	  console.log(
	    `Layout verification passed: ${desktopValue.brandText}, favicon=${desktopValue.faviconHref}, default ${desktopValue.defaultCityValue}, shared map scale ${desktopValue.mapScaleKm}km, floating map chrome, list ratio ${desktopValue.ratio.toFixed(3)}, desktop gaps ${JSON.stringify(desktopValue.listGaps)}, cityAnchorX=${Math.round(desktopValue.cityAnchorX)}, leftFocusX=${Math.round(desktopValue.expectedMapFocusX)}, tag click expands ${Math.round(mapTagValue.collapsedWidth)}->${Math.round(mapTagValue.expandedWidth)} then collapses by tag and map background, zoom stays ${mapTagValue.zoomAfterFirstClick}, detailPopovers=${mapTagValue.detailPopovers}, city switches ${JSON.stringify(citySwitchValue)}, portrait filters ${value.filterHeight}px/${value.filterLabelFontSize}/${value.filterValueFontSize}, landscape filters ${landscapeValue.filterHeight}px/${landscapeValue.filterLabelFontSize}/${landscapeValue.filterValueFontSize}, Chengdu centered at ${Math.round(landscapeValue.cityAnchorCenter.x)}/${Math.round(landscapeValue.cityAnchorCenter.y)}, mobile cost/star/link aligned; AMap status=${value.amapStatus}, liveNodes=${value.liveAmapNodes}, markers=${value.storedMapMarkers}.`,
	  );

  await Promise.race([
    cdp.send("Browser.close").catch(() => undefined),
    delay(500),
  ]);
  cdp.socket.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
} finally {
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  if (userDataDir) {
    rmSync(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
  }
}
