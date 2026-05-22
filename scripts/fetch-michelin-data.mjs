import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwd, exit } from "node:process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";

const execFileAsync = promisify(execFile);
const root = cwd();
const outputDir = join(root, "output", "sources");
const dataOutputPath = join(outputDir, "michelin-guide-china.json");
const tsOutputPath = join(root, "src", "data", "restaurants.ts");
const detailConcurrency = 10;
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);
const chromeBin = chromeCandidates.find((candidate) => existsSync(candidate));

const guideConfigs = [
  {
    name: "Beijing",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/beijing-municipality/beijing/restaurants",
    sourceEditionUrl: "https://guide.michelin.com/en/article/news-and-views/michelin-guide-beijing-2026",
    expectedCount: 98,
    cityCodes: ["beijing"],
  },
  {
    name: "Guangzhou",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/guangdong-province/guangzhou/restaurants",
    sourceEditionUrl: "https://guide.michelin.com/sg/zh_CN/guangdong-province/guangzhou/restaurants",
    expectedCount: 105,
    cityCodes: ["guangzhou"],
  },
  {
    name: "Chengdu",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/chengdu-municipality/chengdu/restaurants",
    sourceEditionUrl: "https://guide.michelin.com/mo/en/article/news-and-views/michelin-guide-chengdu-2026",
    expectedCount: 76,
    cityCodes: ["chengdu"],
  },
  {
    name: "Fujian Province",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/fujian-province/restaurants",
    sourceEditionUrl: "https://guide.michelin.com/en/article/news-and-views/michelin-guide-fujian-2026",
    expectedCount: 96,
    cityCodes: ["fuzhou", "xiamen", "quanzhou", "ningde"],
  },
  {
    name: "Shanghai Municipality",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/shanghai-municipality/restaurants",
    sourceEditionUrl: "https://www.michelin.com/en/publications/products-and-services/michelin-guide-shanghai-jiangsu-zhejiang",
    expectedCount: 155,
    cityCodes: ["shanghai"],
  },
  {
    name: "Jiangsu",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/jiang-su/restaurants",
    sourceEditionUrl: "https://www.michelin.com/en/publications/products-and-services/michelin-guide-shanghai-jiangsu-zhejiang",
    expectedCount: 111,
    cityCodes: ["nanjing", "suzhou", "yangzhou", "changzhou"],
  },
  {
    name: "Zhejiang",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/zhe-jiang/restaurants",
    sourceEditionUrl: "https://www.michelin.com/en/publications/products-and-services/michelin-guide-shanghai-jiangsu-zhejiang",
    expectedCount: 142,
    cityCodes: ["hangzhou", "wenzhou", "taizhou"],
  },
  {
    name: "Hong Kong",
    guideUrl: "https://guide.michelin.com/hk/zh_HK/hong-kong-region/hong-kong/restaurants",
    sourceEditionUrl: "https://www.michelin.com/en/publications/products-and-services/the-michelin-guide-hong-kong-macau-18th-edition",
    expectedCount: 219,
    cityCodes: ["hong-kong"],
  },
  {
    name: "Macau",
    guideUrl: "https://guide.michelin.com/hk/zh_HK/macau-region/macau/restaurants",
    sourceEditionUrl: "https://www.michelin.com/en/publications/products-and-services/the-michelin-guide-hong-kong-macau-18th-edition",
    expectedCount: 59,
    cityCodes: ["macau"],
  },
];

const cityMetadataByMichelinCity = {
  Beijing: {
    code: "beijing",
    cityName: "北京",
    province: "北京",
    country: "中国",
    amapCity: "北京",
  },
  Guangzhou: {
    code: "guangzhou",
    cityName: "广州",
    province: "广东",
    country: "中国",
    amapCity: "广州",
  },
  Chengdu: {
    code: "chengdu",
    cityName: "成都",
    province: "四川",
    country: "中国",
    amapCity: "成都",
  },
  Fuzhou: {
    code: "fuzhou",
    cityName: "福州",
    province: "福建",
    country: "中国",
    amapCity: "福州",
  },
  Xiamen: {
    code: "xiamen",
    cityName: "厦门",
    province: "福建",
    country: "中国",
    amapCity: "厦门",
  },
  Quanzhou: {
    code: "quanzhou",
    cityName: "泉州",
    province: "福建",
    country: "中国",
    amapCity: "泉州",
  },
  Ningde: {
    code: "ningde",
    cityName: "宁德",
    province: "福建",
    country: "中国",
    amapCity: "宁德",
  },
  Shanghai: {
    code: "shanghai",
    cityName: "上海",
    province: "上海",
    country: "中国",
    amapCity: "上海",
  },
  Nanjing: {
    code: "nanjing",
    cityName: "南京",
    province: "江苏",
    country: "中国",
    amapCity: "南京",
  },
  Suzhou: {
    code: "suzhou",
    cityName: "苏州",
    province: "江苏",
    country: "中国",
    amapCity: "苏州",
  },
  Yangzhou: {
    code: "yangzhou",
    cityName: "扬州",
    province: "江苏",
    country: "中国",
    amapCity: "扬州",
  },
  Changzhou: {
    code: "changzhou",
    cityName: "常州",
    province: "江苏",
    country: "中国",
    amapCity: "常州",
  },
  Hangzhou: {
    code: "hangzhou",
    cityName: "杭州",
    province: "浙江",
    country: "中国",
    amapCity: "杭州",
  },
  Wenzhou: {
    code: "wenzhou",
    cityName: "温州",
    province: "浙江",
    country: "中国",
    amapCity: "温州",
  },
  Taizhou: {
    code: "taizhou",
    cityName: "台州",
    province: "浙江",
    country: "中国",
    amapCity: "台州",
  },
  "Hong Kong": {
    code: "hong-kong",
    cityName: "香港",
    province: "香港特别行政区",
    country: "中国",
    amapCity: "香港",
  },
  Macau: {
    code: "macau",
    cityName: "澳门",
    province: "澳门特别行政区",
    country: "中国",
    amapCity: "澳门",
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readExistingIds() {
  if (!existsSync(tsOutputPath)) return { byName: new Map(), bySource: new Map() };
  const source = readFileSync(tsOutputPath, "utf8");
  const jsonStart = source.indexOf("= [") + 2;
  const jsonEnd = source.lastIndexOf("];");
  if (jsonStart < 2 || jsonEnd < 0) return { byName: new Map(), bySource: new Map() };
  const records = JSON.parse(source.slice(jsonStart, jsonEnd + 1));
  const byName = new Map();
  const bySource = new Map();
  records.forEach((record) => {
    byName.set(`${record.city}:${record.name}`, record.id);
    if (record.sourceUrl) bySource.set(record.sourceUrl, record.id);
  });
  return { byName, bySource };
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return response;
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
    if (waiters) waiters.splice(0).forEach((resolve) => resolve(message.params));
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
      waiters.push(resolve);
      eventWaiters.set(method, waiters);
      setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
    });
  }

  return { socket, send, waitForEvent };
}

function pageUrl(baseUrl, page) {
  if (page === 1) return baseUrl;
  return `${baseUrl.replace(/\/$/, "")}/page/${page}`;
}

function mapMichelinLevel(pinName, distinction) {
  const value = `${pinName ?? ""} ${distinction ?? ""}`.toLowerCase();
  if (value.includes("three") || value.includes("3 star")) return "three-stars";
  if (value.includes("two") || value.includes("2 star")) return "two-stars";
  if (value.includes("one") || value.includes("1 star")) return "one-star";
  if (value.includes("bib")) return "bib-gourmand";
  return "selected";
}

function parseRestaurantCount(text) {
  const latin = text.match(/(?:of|OF)\s+(\d+)\s+restaurants/i);
  if (latin) return Number(latin[1]);
  const range = text.match(/:\s*1-\d+\s+of\s+(\d+)/i);
  if (range) return Number(range[1]);
  const chinese = text.match(/共\s*(\d+)\s*[個个的]?\s*餐[廳厅]/);
  if (chinese) return Number(chinese[1]);
  return null;
}

async function waitForGuideList(cdp, minimumCards = 1) {
  let latest = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        text: document.body?.innerText ?? "",
        cardCount: document.querySelectorAll(".restaurant__list-row.js-restaurant__list_items .js-restaurant__list_item").length
      }))()`,
      returnByValue: true,
    });
    latest = result.result.value;
    if (latest.cardCount >= minimumCards || latest.text.includes("0 restaurants")) return latest;
    await delay(500);
  }
  return latest;
}

async function navigate(cdp, url, minimumCards = 1) {
  const loaded = cdp.waitForEvent("Page.loadEventFired", 30000).catch(() => null);
  await cdp.send("Page.navigate", { url });
  await loaded;
  await delay(1500);
  return waitForGuideList(cdp, minimumCards);
}

async function scrapeGuideSelection(cdp, guideConfig) {
  const pageCount = Math.ceil(guideConfig.expectedCount / 48);
  const restaurants = [];

  for (let page = 1; page <= pageCount; page += 1) {
    const html = await fetchGuidePageHtml(pageUrl(guideConfig.guideUrl, page));
    for (const item of extractGuideCards(html, guideConfig.guideUrl)) {
      const cityMetadata = cityMetadataByMichelinCity[item.dtmCity];
      if (!cityMetadata) continue;
      if (!guideConfig.cityCodes.includes(cityMetadata.code)) continue;
      restaurants.push({
        ...item,
        ...cityMetadata,
        city: cityMetadata.code,
        level: mapMichelinLevel(item.mapPinName, item.dtmDistinction),
        sourceEditionUrl: guideConfig.sourceEditionUrl,
      });
    }
  }

  const unique = new Map();
  for (const restaurant of restaurants) {
    unique.set(restaurant.href, restaurant);
  }
  const selectionRestaurants = [...unique.values()];
  assert(
    selectionRestaurants.length === guideConfig.expectedCount,
    `${guideConfig.name} expected ${guideConfig.expectedCount} unique restaurants, got ${selectionRestaurants.length}`,
  );
  return selectionRestaurants;
}

async function fetchGuidePageHtml(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        "curl",
        ["-4", "-sS", "-L", "--max-time", "35", url],
        { maxBuffer: 1024 * 1024 * 8 },
      );
      if (stdout.includes("js-restaurant__list_item")) return stdout;
      lastError = new Error(`Guide page did not contain restaurant cards: ${url}`);
    } catch (error) {
      lastError = error;
    }
    await delay(attempt * 750);
  }

  throw lastError ?? new Error(`Could not fetch guide page: ${url}`);
}

function extractGuideCards(html, baseUrl) {
  return html
    .split('<div class="card__menu selection-card')
    .slice(1)
    .map((chunk) => parseGuideCard(`<div class="card__menu selection-card${chunk}`, baseUrl))
    .filter(Boolean);
}

function parseGuideCard(card, baseUrl) {
  const dtmCity = attr(card, "data-dtm-city");
  const name = attr(card, "data-restaurant-name") || stripHtml(card.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "");
  const hrefRaw = card.match(/href="([^"]*\/restaurant\/[^"]+)"/)?.[1] ?? "";
  const href = hrefRaw ? new URL(decodeHtmlEntities(hrefRaw), baseUrl).href : "";
  const footerLines = [...card.matchAll(/<div class="card__menu-footer--score[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
  const priceCuisine = footerLines.find((line) => line.includes("·")) ?? "";
  const [priceRaw = "", cuisineRaw = ""] = priceCuisine.split("·").map((item) => item.trim());
  const lat = Number(attr(card, "data-lat"));
  const lng = Number(attr(card, "data-lng"));
  const coverImageUrl =
    attr(card, "ci-bg-url") ||
    attr(card, "data-bookmark-image") ||
    [...card.matchAll(/<img[^>]+src="([^"]+)"/g)]
      .map((match) => decodeHtmlEntities(match[1]))
      .find(
        (src) =>
          src &&
          !src.includes("/assets/images/icons/") &&
          !src.includes("list-clipboard") &&
          !src.includes("favorite") &&
          !src.includes("michelin-star") &&
          !src.includes("bib-gourmand"),
      ) ||
    "";

  if (!dtmCity || !name || !href) return null;
  return {
    name,
    href,
    michelinId: attr(card, "data-id") || attr(card, "data-dtm-id"),
    dtmCity,
    dtmDistinction: attr(card, "data-dtm-distinction"),
    dtmDistrict: attr(card, "data-dtm-district"),
    locationLine: footerLines.find((line) => !line.includes("·")) ?? "",
    mapPinName: attr(card, "data-map-pin-name"),
    price: priceRaw,
    cuisine: cuisineRaw,
    coverImageUrl,
    michelinPosition: Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null,
  };
}

function attr(value, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`${escaped}="([^"]*)"`, "i"));
  return decodeHtmlEntities(match?.[1] ?? "").trim();
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseJsonLdRestaurant(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) =>
    match[1].trim(),
  );

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(script));
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const restaurant = items.find((item) => item?.["@type"] === "Restaurant" || item?.type === "Restaurant");
      if (restaurant) return restaurant;
    } catch {
      // Some non-restaurant JSON-LD snippets on the page are not needed here.
    }
  }

  return null;
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function fetchMichelinDetail(restaurant) {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-4", "-sS", "-L", "--max-time", "25", restaurant.href],
      { maxBuffer: 1024 * 1024 * 4 },
    );
    const data = parseJsonLdRestaurant(stdout);
    if (!data) return {};

    const address = formatAddress(data.address);
    const image = Array.isArray(data.image) ? data.image.find(Boolean) : data.image;
    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    const description = stringValue(data.review?.description);
    const cuisine = Array.isArray(data.servesCuisine)
      ? data.servesCuisine.filter(Boolean).join(", ")
      : stringValue(data.servesCuisine);

    return {
      address,
      detailCoverImageUrl: stringValue(image),
      michelinPosition:
        Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : undefined,
      description,
      detailCuisine: cuisine,
      telephone: stringValue(data.telephone),
    };
  } catch (error) {
    console.warn(`[detail] ${restaurant.cityName} ${restaurant.name}: ${error.message}`);
    return {};
  }
}

function formatAddress(address) {
  if (!address || typeof address !== "object") return undefined;
  const street = stringValue(address.streetAddress);
  const locality = stringValue(address.addressLocality);
  const region = stringValue(address.addressRegion);
  if (street) return [street, locality, region].filter(Boolean).join(", ");
  return [locality, region].filter(Boolean).join(", ") || undefined;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function splitRecommendationTags(value) {
  if (!value || Array.isArray(value)) return [];
  return value
    .split(/[，,、/]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 5);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function slugify(value) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return ascii || Buffer.from(value).toString("hex").slice(0, 16);
}

function canonicalIdFromSourceUrl(sourceUrl) {
  try {
    const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    const restaurantIndex = parts.indexOf("restaurant");
    const province = parts[2];
    const city = parts[3];
    const restaurantSlug = restaurantIndex >= 0 ? parts[restaurantIndex + 1] : "";
    const id = ["cn", province, city, restaurantSlug]
      .filter(Boolean)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return id || "";
  } catch {
    return "";
  }
}

function amapSearch(name, cityName) {
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(`${name} ${cityName}`)}`;
}

function normalizeAssetUrl(url) {
  if (!url) return undefined;
  return url.replace(/^http:\/\//, "https://").replace(/\?(?:width|height)=\d+.*$/, "");
}

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng, lat) {
  let ret = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  ret += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(lat * Math.PI) + 40 * Math.sin((lat / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((lat / 12) * Math.PI) + 320 * Math.sin((lat * Math.PI) / 30)) * 2) / 3;
  return ret;
}

function transformLng(lng, lat) {
  let ret = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  ret += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(lng * Math.PI) + 40 * Math.sin((lng / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((lng / 12) * Math.PI) + 300 * Math.sin((lng / 30) * Math.PI)) * 2) / 3;
  return ret;
}

function wgs84ToGcj02(position) {
  if (!position) return undefined;
  const [lng, lat] = position;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  if (outOfChina(lng, lat)) return [lng, lat];

  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [roundCoord(lng + dLng), roundCoord(lat + dLat)];
}

function roundCoord(value) {
  return Math.round(value * 1e7) / 1e7;
}

function toRestaurantRecord(raw, index, existingIds) {
  const sourceId = existingIds.bySource.get(raw.href);
  const nameId = existingIds.byName.get(`${raw.city}:${raw.name}`);
  const generatedId =
    canonicalIdFromSourceUrl(raw.href) ||
    `${raw.city}-${slugify(raw.name)}-${raw.michelinId || String(index + 1).padStart(4, "0")}`;
  const cuisine = raw.detailCuisine || raw.cuisine;
  const position = wgs84ToGcj02(raw.michelinPosition);
  assert(position, `${raw.name} is missing MICHELIN source coordinates`);

  return {
    id: sourceId || nameId || generatedId,
    name: raw.name,
    city: raw.city,
    cityName: raw.cityName,
    province: raw.province,
    country: raw.country,
    district: raw.dtmDistrict || raw.cityName,
    address: raw.address,
    level: raw.level,
    michelinPrice: raw.price,
    topDishes: splitRecommendationTags(cuisine),
    cuisine,
    poiQuery: `${raw.name} ${raw.cityName}`,
    position,
    coorSys: "GCJ-02",
    coordinateSource: "michelin",
    mapsUrl: amapSearch(raw.name, raw.cityName),
    coverImageUrl: normalizeAssetUrl(raw.coverImageUrl || raw.detailCoverImageUrl),
    sourceUrl: raw.href,
    sourceEditionUrl: raw.sourceEditionUrl,
  };
}

function stringifyTs(records) {
  return `import type { Restaurant } from "../types";

export const restaurants: Restaurant[] = ${JSON.stringify(records, null, 2)};
`;
}

function countBy(records, field) {
  return records.reduce((acc, record) => {
    acc[record[field]] = (acc[record[field]] ?? 0) + 1;
    return acc;
  }, {});
}

async function main() {
  assert(chromeBin, "Chrome or Chromium is required");
  mkdirSync(outputDir, { recursive: true });
  const existingIds = readExistingIds();
  const debugPort = await getFreePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "michelin-guide-fetch-"));
  let chrome = null;

  try {
    chrome = spawn(
      chromeBin,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${debugPort}`,
        "--window-size=1440,1200",
        `--user-data-dir=${userDataDir}`,
        "about:blank",
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );

    const cdp = await openCdpSocket(debugPort);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const guideRestaurants = [];
    for (const guideConfig of guideConfigs) {
      const selectionRestaurants = await scrapeGuideSelection(cdp, guideConfig);
      console.log(
        `[guide] ${guideConfig.name}: ${selectionRestaurants.length} restaurants from ${guideConfig.guideUrl}`,
      );
      guideRestaurants.push(...selectionRestaurants);
    }

    cdp.socket.close();

    const unique = new Map();
    guideRestaurants.forEach((restaurant) => {
      unique.set(restaurant.href, restaurant);
    });
    const uniqueRestaurants = [...unique.values()];
    const details = await mapWithConcurrency(uniqueRestaurants, detailConcurrency, async (restaurant, index) => {
      const detail = await fetchMichelinDetail(restaurant);
      if ((index + 1) % 50 === 0 || index === uniqueRestaurants.length - 1) {
        console.log(`[detail] ${index + 1}/${uniqueRestaurants.length}`);
      }
      return detail;
    });

    const enriched = uniqueRestaurants.map((restaurant, index) => ({
      ...restaurant,
      ...details[index],
      coverImageUrl: restaurant.coverImageUrl || details[index].detailCoverImageUrl,
      michelinPosition: details[index].michelinPosition || restaurant.michelinPosition,
    }));

    const records = enriched.map((restaurant, index) => toRestaurantRecord(restaurant, index, existingIds));
    const missingCovers = records.filter((record) => !record.coverImageUrl);
    assert(missingCovers.length === 0, `Missing official cover images: ${missingCovers.map((item) => item.name).join(", ")}`);

    writeFileSync(
      dataOutputPath,
      `${JSON.stringify(
        {
          fetchedAt: new Date().toISOString(),
          source: "MICHELIN Guide official China list pages and official restaurant JSON-LD details",
          coordinateTransform: "MICHELIN WGS-84 detail/list coordinates converted locally to GCJ-02 for AMap display",
          total: records.length,
          guideCounts: Object.fromEntries(guideConfigs.map((guideConfig) => [guideConfig.name, guideConfig.expectedCount])),
          cityCounts: countBy(records, "city"),
          cityNameCounts: countBy(records, "cityName"),
          records,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(tsOutputPath, stringifyTs(records));
    console.log(`[write] ${dataOutputPath}`);
    console.log(`[write] ${tsOutputPath}`);
  } finally {
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill("SIGTERM");
    }
    try {
      rmSync(userDataDir, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
    } catch {
      // Temporary browser cache cleanup is best-effort.
    }
  }
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
