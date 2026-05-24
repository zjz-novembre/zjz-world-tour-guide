import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { cwd, env, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const outputPath = join(root, "output", "sources", "amap-poi-coordinate-audit.json");
const amapConfigPath = join(root, "public", "amap-config.json");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
    return [key, valueParts.length ? valueParts.join("=") : "true"];
  }),
);

const chromeCandidates = [
  env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

const chromeBin = chromeCandidates.find((candidate) => existsSync(candidate));
const key =
  env.VITE_AMAP_KEY?.trim() ||
  env.AMAP_WEB_KEY?.trim() ||
  (existsSync(amapConfigPath) ? JSON.parse(readFileSync(amapConfigPath, "utf8")).key?.trim() : "");
const serviceKey = env.AMAP_SERVICE_KEY?.trim() || env.AMAP_REST_KEY?.trim() || "";
const securityCode =
  env.VITE_AMAP_SECURITY_CODE?.trim() ||
  env.AMAP_SECURITY_CODE?.trim() ||
  (existsSync(amapConfigPath)
    ? JSON.parse(readFileSync(amapConfigPath, "utf8")).securityCode?.trim()
    : "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readSqliteRows(databasePath, guide) {
  const sql = `
    SELECT
      id,
      name,
      city_code AS city,
      city_name AS cityName,
      province,
      country,
      district,
      address,
      latitude,
      longitude,
      coordinate_source AS coordinateSource,
      amap_poi_id AS amapPoiId,
      amap_poi_query AS poiQuery,
      amap_maps_url AS mapsUrl,
      redirect_link AS redirectLink
    FROM restaurants
    ORDER BY city_name COLLATE NOCASE, name COLLATE NOCASE;
  `;
  const result = spawnSync("sqlite3", ["-json", databasePath, sql], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert(result.status === 0, result.stderr || `sqlite3 failed for ${databasePath}`);
  return JSON.parse(result.stdout || "[]").map((row) => ({
    ...row,
    guide,
    position: [Number(row.longitude), Number(row.latitude)],
  }));
}

function readRestaurants() {
  const guide = args.get("guide") ?? "all";
  const rows = [];
  if (guide === "all" || guide === "michelin") {
    rows.push(...readSqliteRows(join(root, "database", "michelin-restaurants.sqlite"), "michelin"));
  }
  if (guide === "all" || guide === "black-pearl") {
    rows.push(...readSqliteRows(join(root, "database", "black-pearl-restaurants.sqlite"), "black-pearl"));
  }

  const cityFilter = new Set(parseList(args.get("city")));
  const idFilter = new Set(parseList(args.get("ids")));
  const limit = Number(args.get("limit") ?? 0);
  const filtered = rows.filter((row) => {
    if (cityFilter.size && !cityFilter.has(row.city) && !cityFilter.has(row.cityName)) return false;
    if (idFilter.size && !idFilter.has(row.id)) return false;
    return true;
  });
  return limit > 0 ? filtered.slice(0, limit) : filtered;
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s·•.。、，,，:：;；'"“”‘’_\-—–/\\()[\]（）【】{}]/g, "")
    .replace(/餐厅|酒家|饭店|食府|小馆|料理|店$/g, "");
}

function coreName(value) {
  return normalizeText(String(value ?? "").replace(/[（(].*?[）)]/g, ""));
}

function distanceMeters(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return null;
  const [lng1, lat1] = left.map(Number);
  const [lng2, lat2] = right.map(Number);
  if (![lng1, lat1, lng2, lat2].every(Number.isFinite)) return null;
  const toRad = (value) => (value * Math.PI) / 180;
  const radius = 6371008.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function nameScore(record, poi) {
  const recordName = normalizeText(record.name);
  const recordCore = coreName(record.name);
  const queryName = normalizeText(record.poiQuery);
  const poiName = normalizeText(poi.name);
  if (!recordName || !poiName) return 0;
  if (recordName === poiName) return 1;
  if (queryName && queryName === poiName) return 0.98;
  if (recordName.includes(poiName) || poiName.includes(recordName)) return 0.92;
  if (recordCore && (recordCore === poiName || poiName.includes(recordCore))) return 0.82;
  if (recordCore && recordCore.length >= 3 && poiName.includes(recordCore.slice(0, 3))) return 0.62;
  return 0;
}

function addressScore(record, poi) {
  const recordAddress = normalizeText(record.address);
  const poiAddress = normalizeText(poi.address);
  if (!recordAddress || !poiAddress) return 0;
  if (recordAddress === poiAddress) return 1;
  if (recordAddress.includes(poiAddress) || poiAddress.includes(recordAddress)) return 0.8;
  const tokens = String(record.address)
    .split(/[ ,，、。;；·•\-—–()（）【】]/)
    .map(normalizeText)
    .filter((token) => token.length >= 3);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => poiAddress.includes(token)).length;
  return hits / tokens.length;
}

function districtScore(record, poi) {
  const district = normalizeText(record.district);
  const adname = normalizeText(poi.district || poi.adname);
  if (!district || !adname) return 0;
  return district === adname || district.includes(adname) || adname.includes(district) ? 1 : 0;
}

function cityScore(record, poi) {
  const city = normalizeText(record.cityName);
  const poiCity = normalizeText(poi.city || poi.cityname);
  if (!city || !poiCity) return 0;
  return city === poiCity || city.includes(poiCity) || poiCity.includes(city) ? 1 : 0;
}

function candidateScore(record, poi) {
  const distance = distanceMeters(record.position, poi.position);
  const name = nameScore(record, poi);
  const address = addressScore(record, poi);
  const district = districtScore(record, poi);
  const city = cityScore(record, poi);
  const food = /餐饮|美食|中餐|西餐|日本|韩国|东南亚|外国餐厅|咖啡|酒吧|restaurant/i.test(
    `${poi.type ?? ""} ${poi.typecode ?? ""}`,
  )
    ? 1
    : 0;
  const distanceScore =
    distance === null ? 0 : distance <= 80 ? 1 : distance <= 200 ? 0.8 : distance <= 500 ? 0.45 : 0;
  return {
    score: Number((name * 0.48 + address * 0.18 + district * 0.12 + city * 0.08 + food * 0.07 + distanceScore * 0.07).toFixed(4)),
    name,
    address,
    district,
    city,
    food,
    distance,
  };
}

async function fetchAmapJson(url, attempt = 1) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const payload = await response.json();
  if (payload.status === "1") return payload;
  const infocode = String(payload.infocode ?? "");
  if (attempt < 4 && ["10020", "10021", "10022", "10029"].includes(infocode)) {
    await delay(900 * attempt);
    return fetchAmapJson(url, attempt + 1);
  }
  throw new Error(`${payload.info ?? "AMap request failed"} (${infocode || "unknown"})`);
}

function parseRestLocation(value) {
  const [lng, lat] = String(value ?? "")
    .split(",")
    .map((item) => Number(item));
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function restPoiToCandidate(poi, query) {
  return {
    id: poi.id || "",
    name: poi.name || "",
    address: Array.isArray(poi.address) ? poi.address.join("") : poi.address || "",
    district: poi.adname || "",
    city: poi.cityname || "",
    province: poi.pname || "",
    type: poi.type || "",
    typecode: poi.typecode || "",
    tel: poi.tel || "",
    position: parseRestLocation(poi.location),
    query,
  };
}

async function searchRecordRest(record) {
  const seen = new Set();
  const candidates = [];
  for (const query of uniqueQueries(record)) {
    const url = new URL("https://restapi.amap.com/v3/place/text");
    url.searchParams.set("key", serviceKey);
    url.searchParams.set("keywords", query);
    url.searchParams.set("city", record.cityName);
    url.searchParams.set("citylimit", "true");
    url.searchParams.set("offset", String(Number(args.get("page-size") ?? 12)));
    url.searchParams.set("page", "1");
    url.searchParams.set("extensions", "all");
    url.searchParams.set("output", "json");
    const payload = await fetchAmapJson(url);
    const pois = Array.isArray(payload.pois) ? payload.pois : [];
    for (const poi of pois) {
      const candidate = restPoiToCandidate(poi, query);
      if (!candidate.position) continue;
      const key = candidate.id || [candidate.name, candidate.address, candidate.position.join(",")].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
    const best = candidates
      .map((candidate) => ({ candidate, metrics: candidateScore(record, candidate) }))
      .sort((left, right) => right.metrics.score - left.metrics.score)[0];
    if (
      candidates.length >= Number(args.get("stop-after-candidates") ?? 18) ||
      (best &&
        best.metrics.score >= Number(args.get("early-stop-score") ?? 0.72) &&
        best.metrics.name >= 0.62 &&
        (best.metrics.city >= 1 || best.metrics.district >= 1 || best.metrics.address >= 0.6))
    ) {
      break;
    }
    await delay(Number(args.get("query-delay-ms") ?? 60));
  }
  return candidates;
}

function uniqueQueries(record) {
  const values = [
    record.address ? `${record.name} ${record.address}` : "",
    record.poiQuery,
    `${record.name} ${record.district ?? ""} ${record.cityName}`,
    `${record.name} ${record.cityName}`,
    coreName(record.name) && coreName(record.name) !== normalizeText(record.name)
      ? `${String(record.name).replace(/[（(].*?[）)]/g, "")} ${record.district ?? ""} ${record.cityName}`
      : "",
  ];
  const seen = new Set();
  return values
    .map((value) => String(value ?? "").replace(/\s+/g, " ").trim())
    .filter((value) => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function classify(record, selected, candidates) {
  if (!candidates.length) return "no_match";
  if (!selected) return "ambiguous";
  const metrics = selected.metrics;
  if (metrics.name < 0.62 && metrics.address < 0.35) return "ambiguous";
  if (metrics.distance !== null && metrics.distance > 500 && metrics.score >= 0.62) return "coordinate_mismatch";
  if (metrics.distance !== null && metrics.distance > 250 && metrics.score >= 0.72) return "coordinate_review";
  if (!record.address && selected.address) return "missing_address";
  return "ok";
}

function summarize(records) {
  return records.reduce(
    (acc, record) => {
      const guide = record.guide;
      const city = record.cityName;
      const status = record.status;
      acc.status[status] = (acc.status[status] ?? 0) + 1;
      acc.guide[guide] ??= {};
      acc.guide[guide][status] = (acc.guide[guide][status] ?? 0) + 1;
      acc.city[city] ??= {};
      acc.city[city][status] = (acc.city[city][status] ?? 0) + 1;
      return acc;
    },
    { status: {}, guide: {}, city: {} },
  );
}

function buildPayload(records, complete) {
  return {
    fetchedAt: new Date().toISOString(),
    source: records.transport === "rest" ? "AMap Web Service place/text" : "AMap JSAPI PlaceSearch",
    transport: records.transport,
    complete,
    count: records.length,
    summary: summarize(records),
    records,
  };
}

function writeAudit(records, complete) {
  mkdirSync(join(root, "output", "sources"), { recursive: true });
  const payload = buildPayload(records, complete);
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(typeof address === "object" && address, "Could not allocate port");
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function pageHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<title>AMap POI Audit</title>
<script>
window._AMapSecurityConfig = ${securityCode ? JSON.stringify({ securityJsCode: securityCode }) : "{}"};
window.__amapReady = new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.PlaceSearch";
  script.onload = () => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.AMap && window.AMap.PlaceSearch) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started > 15000) {
        clearInterval(timer);
        reject(new Error("AMap.PlaceSearch did not load"));
      }
    }, 100);
  };
  script.onerror = () => reject(new Error("AMap JSAPI failed to load"));
  document.head.appendChild(script);
});
window.__auditSearch = async function auditSearch(payload) {
  await window.__amapReady;
  const queries = payload.queries || [];
  const seen = new Set();
  const results = [];
  async function search(query) {
    const placeSearch = new AMap.PlaceSearch({
      city: payload.cityName,
      citylimit: true,
      pageSize: payload.pageSize || 12,
      pageIndex: 1,
      extensions: "all"
    });
    return new Promise((resolve) => {
      placeSearch.search(query, (status, result) => {
        if (status !== "complete" || typeof result === "string") {
          resolve({ query, status, info: typeof result === "string" ? result : result?.info, pois: [] });
          return;
        }
        const pois = Array.isArray(result?.poiList?.pois) ? result.poiList.pois : [];
        resolve({
          query,
          status,
          info: result.info,
          pois: pois.map((poi) => {
            const location = poi.location;
            return {
              id: poi.id || "",
              name: poi.name || "",
              address: Array.isArray(poi.address) ? poi.address.join("") : (poi.address || ""),
              district: poi.adname || "",
              city: poi.cityname || "",
              province: poi.pname || "",
              type: poi.type || "",
              typecode: poi.typecode || "",
              tel: poi.tel || "",
              position: location && Number.isFinite(location.lng) && Number.isFinite(location.lat)
                ? [Number(location.lng), Number(location.lat)]
                : null
            };
          })
        });
      });
    });
  }
  for (const query of queries) {
    const result = await search(query);
    for (const poi of result.pois) {
      if (!poi.position) continue;
      const key = poi.id || [poi.name, poi.address, poi.position.join(",")].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ ...poi, query });
    }
    if (results.length >= (payload.stopAfterCandidates || 18)) break;
  }
  return results;
};
</script>
<body>ready</body>`;
}

function startServer(port) {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(pageHtml());
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function waitForJson(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return response.json();
    } catch {
      await delay(150);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((sendResolve, sendReject) => {
            pending.set(id, { resolve: sendResolve, reject: sendReject });
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("error", () => reject(new Error("Failed to connect to Chrome DevTools")));
  });
}

async function launchBrowser(pagePort) {
  const debugPort = await getFreePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "amap-poi-audit-"));
  const chrome = spawn(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      `http://127.0.0.1:${pagePort}/`,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  const list = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const page = list.find((item) => item.type === "page") ?? list[0];
  assert(page?.webSocketDebuggerUrl, "Could not find Chrome DevTools page target");
  const cdp = await connectCdp(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Runtime.evaluate", {
    expression: "window.__amapReady",
    awaitPromise: true,
    returnByValue: true,
  });
  return {
    cdp,
    async close() {
      cdp.close();
      chrome.kill("SIGTERM");
      await delay(200);
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

async function searchRecord(cdp, record) {
  const expression = `window.__auditSearch(${JSON.stringify({
    cityName: record.cityName,
    queries: uniqueQueries(record),
    pageSize: Number(args.get("page-size") ?? 12),
    stopAfterCandidates: Number(args.get("stop-after-candidates") ?? 18),
  })})`;
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 25000,
  });
  return result.result?.value ?? [];
}

async function main() {
  const transport = args.get("transport") ?? (serviceKey ? "rest" : "js");
  if (transport === "rest") {
    assert(serviceKey, "Set AMAP_SERVICE_KEY/AMAP_REST_KEY for REST POI audit");
  } else {
    assert(chromeBin, "Chrome or Chromium is required for AMap JSAPI POI audit");
    assert(key, "Set VITE_AMAP_KEY/AMAP_WEB_KEY or public/amap-config.json key");
  }
  const restaurants = readRestaurants();
  const delayMs = Number(args.get("delay-ms") ?? 180);
  const checkpointEvery = Number(args.get("checkpoint-every") ?? 25);
  const pagePort = transport === "js" ? await getFreePort() : null;
  const server = transport === "js" ? await startServer(pagePort) : null;
  const browser = transport === "js" ? await launchBrowser(pagePort) : null;
  const records = [];
  records.transport = transport;

  try {
    for (let index = 0; index < restaurants.length; index += 1) {
      const restaurant = restaurants[index];
      let candidates = [];
      let error = null;
      try {
        candidates =
          transport === "rest"
            ? await searchRecordRest(restaurant)
            : await searchRecord(browser.cdp, restaurant);
      } catch (searchError) {
        error = searchError instanceof Error ? searchError.message : String(searchError);
      }

      const scored = candidates
        .map((candidate) => ({
          ...candidate,
          metrics: candidateScore(restaurant, candidate),
        }))
        .sort((left, right) => right.metrics.score - left.metrics.score);
      const selected = scored[0] ?? null;
      const status = error ? "error" : classify(restaurant, selected, scored);

      records.push({
        id: restaurant.id,
        guide: restaurant.guide,
        name: restaurant.name,
        city: restaurant.city,
        cityName: restaurant.cityName,
        district: restaurant.district,
        currentAddress: restaurant.address ?? null,
        currentPosition: restaurant.position,
        currentCoordinateSource: restaurant.coordinateSource,
        currentAmapPoiId: restaurant.amapPoiId ?? null,
        queries: uniqueQueries(restaurant),
        status,
        selected: selected
          ? {
              id: selected.id,
              name: selected.name,
              address: selected.address,
              city: selected.city,
              district: selected.district,
              province: selected.province,
              type: selected.type,
              typecode: selected.typecode,
              position: selected.position,
              query: selected.query,
              metrics: selected.metrics,
            }
          : null,
        candidates: scored.slice(0, Number(args.get("keep-candidates") ?? 5)).map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          address: candidate.address,
          city: candidate.city,
          district: candidate.district,
          province: candidate.province,
          type: candidate.type,
          position: candidate.position,
          query: candidate.query,
          metrics: candidate.metrics,
        })),
        error,
      });

      if ((index + 1) % 25 === 0 || index + 1 === restaurants.length) {
        console.log(`[amap-audit] ${index + 1}/${restaurants.length}`);
      }
      if (checkpointEvery > 0 && ((index + 1) % checkpointEvery === 0 || index + 1 === restaurants.length)) {
        writeAudit(records, index + 1 === restaurants.length);
      }
      if (delayMs > 0) await delay(delayMs);
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  const payload = writeAudit(records, true);
  console.log(`[write] ${outputPath}`);
  console.log(`[summary] ${JSON.stringify(payload.summary.status)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
