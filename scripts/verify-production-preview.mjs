import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer as createHttpServer } from "node:http";
import { cwd, env, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const root = cwd();
const port = env.PRODUCTION_PREVIEW_PORT ?? "4182";
const previewBasePath = env.PRODUCTION_PREVIEW_BASE_PATH ?? env.MICHELIN_BASE_PATH ?? "/michelin/";
const normalizedBasePath = previewBasePath.startsWith("/")
  ? previewBasePath
  : `/${previewBasePath}`;
const appUrl = `http://127.0.0.1:${port}${normalizedBasePath.endsWith("/") ? normalizedBasePath : `${normalizedBasePath}/`}`;
const blackPearlUrl = `http://127.0.0.1:${port}/black-pearl/`;
const cssWhitespace = String.raw`\s*`;
const rotate45 = String.raw`rotate\(45deg\)`;

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

  throw new Error(`Production preview did not become ready at ${url}`);
}

let server = null;

function stopPreview(activeServer) {
  return new Promise((resolve) => {
    if (!activeServer) {
      resolve();
      return;
    }

    activeServer.close(() => {
      resolve();
    });
  });
}

async function startWorkerPreview(activePort) {
  const workerPath = join(root, "cloudflare", "michelin-worker", "worker.mjs");
  assert(existsSync(workerPath), "Run npm run deploy:worker:build before production preview verification");
  const worker = await import(pathToFileURL(workerPath));

  const activeServer = createHttpServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
          value.forEach((item) => headers.append(key, item));
        } else if (value !== undefined) {
          headers.set(key, value);
        }
      }

      const request = new Request(`http://127.0.0.1:${activePort}${req.url ?? "/"}`, {
        headers,
        method: req.method,
      });
      const response = await worker.default.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    activeServer.once("error", reject);
    activeServer.listen(Number(activePort), "127.0.0.1", resolve);
  });

  return activeServer;
}

try {
  assert(existsSync(join(root, "dist/index.html")), "Run npm run build before production preview verification");

  server = await startWorkerPreview(port);

  await waitForServer(appUrl);

  const html = await fetch(appUrl).then((response) => response.text());
  const scriptPath = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  const stylesheetPath = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
  assert(html.includes("Lite Michelin"), "Production preview did not serve the Lite Michelin HTML");
  assert(html.includes('/michelin/favicon.svg'), "Production preview did not serve the ZJZ favicon link");
  assert(scriptPath?.startsWith("/michelin/assets/"), `Production script is not scoped to /michelin: ${scriptPath}`);
  assert(stylesheetPath?.startsWith("/michelin/assets/"), `Production stylesheet is not scoped to /michelin: ${stylesheetPath}`);

  const script = await fetch(new URL(scriptPath, appUrl)).then((response) => response.text());
  const stylesheet = await fetch(new URL(stylesheetPath, appUrl)).then((response) => response.text());
  const apiPayload = await fetch(new URL("api/restaurants", appUrl)).then((response) => response.json());
  const amapConfig = await fetch(new URL("amap-config.json", appUrl)).then((response) => response.json());
  const blackPearlHtml = await fetch(blackPearlUrl).then((response) => {
    assert(response.ok, `Production preview did not serve Black Pearl HTML: HTTP ${response.status}`);
    return response.text();
  });
  const blackPearlApiPayload = await fetch(new URL("api/restaurants", blackPearlUrl)).then((response) => response.json());
  const blackPearlAmapConfig = await fetch(new URL("amap-config.json", blackPearlUrl)).then((response) => response.json());
  const favicon = await fetch(new URL("favicon.svg", appUrl));
  const bibIcon = await fetch(new URL("michelin-bib-gourmand-white.svg", appUrl));
  const starIcon = await fetch(new URL("michelin-star-white.svg", appUrl));
  const selectedIcon = await fetch(new URL("restaurant-selected-white.svg", appUrl));

  assert(script.includes("amap-surface"), "Production bundle does not contain the AMap surface");
  assert(script.includes("map-marker__tag"), "Production bundle does not contain restaurant map tags");
  assert(script.includes("SHANGHAI_INNER_RING_SPAN_KM") || script.includes("data-map-scale-km"), "Production bundle does not contain shared map-scale marker");
  assert(script.includes("closest(\".map-marker, .offline-city-map__marker\")"), "Production bundle does not keep tag clicks separate from map-background collapse");
  assert(script.includes("map-user-location"), "Production bundle does not contain user-location marker support");
  assert(script.includes("map-user-location__arrow") && script.includes("--user-heading"), "Production bundle does not contain heading-aware user-location arrow support");
  assert(script.includes("restaurant-selected-white.svg"), "Production bundle does not contain the selected restaurant marker icon");
  assert(stylesheet.includes("--color-gold:#a2793d") || stylesheet.includes("--color-gold: #a2793d"), "Production stylesheet does not contain the Bib yellow token");
  assert(stylesheet.includes("map-marker--bib-gourmand") && stylesheet.includes("var(--color-gold)"), "Production stylesheet does not apply Bib yellow to Bib marker pins");
  assert(stylesheet.includes("map-marker--selected") && stylesheet.includes("var(--color-muted)"), "Production stylesheet does not apply selected gray to selected marker pins");
  assert(
    !/\.map-marker__tag-level\{[^}]*font-size/.test(stylesheet) &&
      !/\.map-marker__tag-level\{[^}]*font-weight/.test(stylesheet),
    "Production stylesheet changes map-tag level typography instead of only changing its color",
  );
  assert(stylesheet.includes("map-user-location__arrow") && stylesheet.includes("rotate(var(--user-heading"), "Production stylesheet does not render GPS as a direction arrow");
  assert(new RegExp(`calc\\(var\\(--size-map-pin-bib-icon\\)${cssWhitespace}\\*${cssWhitespace}(?:0?\\.9)\\)`).test(stylesheet), "Production stylesheet does not shrink Bib marker SVG by 10%");
  assert(
    new RegExp(`${rotate45}${cssWhitespace}(?:translate\\(0,${cssWhitespace}-8%\\)|translateY\\(-8%\\))`).test(stylesheet),
    "Production stylesheet does not move Bib marker SVG straight up by 8% after counter-rotation",
  );
  assert(new RegExp(`${rotate45}${cssWhitespace}translate\\(5%,${cssWhitespace}10%\\)`).test(stylesheet), "Production stylesheet does not move selected marker SVG right by 5% and down by 10% after counter-rotation");
  assert(script.includes("navigator.geolocation.getCurrentPosition"), "Production bundle does not request geolocation");
  assert(html.includes("<title>Lite Michelin</title>"), "Production HTML tab title is not Lite Michelin");
  assert(script.includes('city:"shanghai"'), "Production bundle default city is not Shanghai");
  assert(script.includes("MICHELIN"), "Production bundle does not contain MICHELIN page chrome");
  assert(!script.includes("mapkit-surface"), "Production bundle still contains MapKit surface");
  assert(!script.includes("brand__mark"), "Production bundle still contains circular M mark");
  assert(
      script.includes("restaurant-row__mobile-card") &&
      stylesheet.includes("restaurant-row__mobile-line") &&
      stylesheet.includes("grid-template-columns:var(--size-thumb) minmax(0,1fr)") &&
      stylesheet.includes("grid-template-columns:minmax(0,1fr) auto auto auto") &&
      stylesheet.includes("restaurant-row__mobile-dishes") &&
      stylesheet.includes("gap:var(--space-1)"),
    "Production bundle is missing the refactored compact mobile restaurant card",
  );
  assert(apiPayload.source === "sqlite" && apiPayload.count === 1060, `Production API payload mismatch: ${JSON.stringify({ source: apiPayload.source, count: apiPayload.count })}`);
  assert(blackPearlHtml.includes("<title>Lite Michelin</title>"), "Production preview did not serve the shared app shell for Black Pearl");
  assert(
    blackPearlApiPayload.source === "sqlite" && blackPearlApiPayload.count === 326,
    `Production Black Pearl API payload mismatch: ${JSON.stringify({ source: blackPearlApiPayload.source, count: blackPearlApiPayload.count })}`,
  );
  assert(
    typeof amapConfig.key === "string" &&
      amapConfig.key.length > 0 &&
      blackPearlAmapConfig.key === amapConfig.key,
    "Production worker did not serve shared AMap runtime config for both guides",
  );
  assert(favicon.ok && bibIcon.ok && starIcon.ok && selectedIcon.ok, "Production worker did not serve favicon and Michelin marker icons");

  console.log(
    `Production preview verification passed: worker serves Lite Michelin tab title with MICHELIN page chrome at ${normalizedBasePath}, Black Pearl at /black-pearl/, ZJZ favicon, scoped assets, 1060-row Michelin API, 326-row Black Pearl API, map-background collapse bundle, shared city scale, portrait/landscape mobile alignment CSS, Bib yellow pins, selected gray pins, and Michelin marker icons.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
} finally {
  await stopPreview(server);
}
