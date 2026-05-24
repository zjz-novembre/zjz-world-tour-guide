import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { cwd, env, exit } from "node:process";

const root = cwd();
const distDir = join(root, "dist");
const databasePath = join(root, "database", "michelin-restaurants.sqlite");
const blackPearlDatabasePath = join(root, "database", "black-pearl-restaurants.sqlite");
const outputDir = join(root, "cloudflare", "michelin-worker");
const outputPath = join(outputDir, "worker.mjs");
const deployBase = "/michelin";
const blackPearlDeployBase = "/black-pearl";
const defaultAmapWebKey = "13439ae546f79828aea6795282889376";
const amapConfig = {
  key: (env.VITE_AMAP_KEY || defaultAmapWebKey).trim(),
  ...(env.VITE_AMAP_SECURITY_CODE?.trim()
    ? { securityCode: env.VITE_AMAP_SECURITY_CODE.trim() }
    : {}),
};

const RESTAURANTS_SQL = `
SELECT
  id,
  name,
  english_name AS englishName,
  city_code AS city,
  city_name AS cityName,
  province,
  country,
  district,
  address,
  michelin_level AS level,
  avg_price_cny AS avgPriceCny,
  michelin_price_band AS michelinPrice,
  recommended_dishes_json AS recommendedDishesJson,
  dianping_url AS dianpingUrl,
  dianping_app_shop_id AS dianpingAppShopId,
  dianping_app_url AS dianpingAppUrl,
  cuisine,
  amap_poi_query AS poiQuery,
  longitude,
  latitude,
  coor_sys AS coorSys,
  coor_sys AS coordinateSystem,
  coordinate_source AS coordinateSource,
  amap_poi_id AS amapPoiId,
  redirect_link AS mapsUrl,
  cover_image AS coverImageUrl,
  michelin_source_url AS sourceUrl
FROM restaurants
ORDER BY
  CASE city_code
    WHEN 'beijing' THEN 1
    WHEN 'guangzhou' THEN 2
    WHEN 'chengdu' THEN 3
    WHEN 'fuzhou' THEN 4
    WHEN 'xiamen' THEN 5
    WHEN 'quanzhou' THEN 6
    WHEN 'ningde' THEN 7
    WHEN 'shanghai' THEN 8
    WHEN 'nanjing' THEN 9
    WHEN 'suzhou' THEN 10
    WHEN 'yangzhou' THEN 11
    WHEN 'changzhou' THEN 12
    WHEN 'hangzhou' THEN 13
    WHEN 'wenzhou' THEN 14
    WHEN 'taizhou' THEN 15
    WHEN 'hong-kong' THEN 16
    WHEN 'macau' THEN 17
    ELSE 18
  END,
  CASE michelin_level
    WHEN 'three-stars' THEN 1
    WHEN 'two-stars' THEN 2
    WHEN 'one-star' THEN 3
    WHEN 'bib-gourmand' THEN 4
    WHEN 'selected' THEN 5
    ELSE 6
  END,
  name COLLATE NOCASE;
`;

const BLACK_PEARL_RESTAURANTS_SQL = `
SELECT
  id,
  name,
  english_name AS englishName,
  city_code AS city,
  city_name AS cityName,
  province,
  country,
  district,
  address,
  black_pearl_level AS level,
  avg_price_cny AS avgPriceCny,
  black_pearl_price_display AS michelinPrice,
  recommended_dishes_json AS recommendedDishesJson,
  dianping_url AS dianpingUrl,
  dianping_app_shop_id AS dianpingAppShopId,
  dianping_app_url AS dianpingAppUrl,
  cuisine,
  amap_poi_query AS poiQuery,
  longitude,
  latitude,
  coor_sys AS coorSys,
  coor_sys AS coordinateSystem,
  coordinate_source AS coordinateSource,
  amap_poi_id AS amapPoiId,
  redirect_link AS mapsUrl,
  cover_image AS coverImageUrl,
  black_pearl_source_url AS sourceUrl
FROM restaurants
ORDER BY
  city_name COLLATE NOCASE,
  CASE black_pearl_level
    WHEN 'three-stars' THEN 1
    WHEN 'two-stars' THEN 2
    WHEN 'one-star' THEN 3
    ELSE 4
  END,
  name COLLATE NOCASE;
`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readRestaurants(activeDatabasePath, sql) {
  const result = spawnSync("sqlite3", ["-json", activeDatabasePath, sql], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  assert(result.status === 0, result.stderr || "sqlite3 failed to read restaurant database");

  const rows = JSON.parse(result.stdout || "[]");
  return rows.map(mapRestaurant);
}

function mapRestaurant(row) {
  const longitude = Number(row.longitude);
  const latitude = Number(row.latitude);
  const recommendedDishes = JSON.parse(row.recommendedDishesJson || "[]");

  return stripUndefined({
    id: row.id,
    name: row.name,
    englishName: row.englishName || undefined,
    city: row.city,
    cityName: row.cityName,
    province: row.province,
    country: row.country,
    district: row.district ?? "",
    address: row.address || undefined,
    level: row.level,
    costPerPersonCny: typeof row.avgPriceCny === "number" ? row.avgPriceCny : undefined,
    michelinPrice: row.michelinPrice ?? "",
    topDishes: recommendedDishes,
    dianpingUrl: row.dianpingUrl || undefined,
    dianpingAppShopId: row.dianpingAppShopId || undefined,
    dianpingAppUrl: row.dianpingAppUrl || undefined,
    dianpingAvgPriceCny:
      row.dianpingUrl && typeof row.avgPriceCny === "number" ? row.avgPriceCny : undefined,
    dianpingRecommendedDishes: row.dianpingUrl ? recommendedDishes : [],
    cuisine: row.cuisine ?? "",
    poiQuery: row.poiQuery ?? row.name,
    position: [longitude, latitude],
    coorSys: row.coorSys,
    coordinateSystem: row.coordinateSystem,
    coordinateSource: row.coordinateSource,
    amapPoiId: row.amapPoiId || undefined,
    mapsUrl: row.mapsUrl ?? row.sourceUrl,
    coverImageUrl: row.coverImageUrl || undefined,
    sourceUrl: row.sourceUrl,
  });
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function walkFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    return stats.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function contentTypeFor(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function readAssets() {
  return walkFiles(distDir).map((filePath) => {
    const publicPath = `/${relative(distDir, filePath).split(sep).join("/")}`;
    const contentType = contentTypeFor(filePath);
    const isText =
      contentType.includes("charset=utf-8") ||
      contentType === "application/json; charset=utf-8";
    return [
      publicPath,
      isText
        ? { body: readFileSync(filePath, "utf8"), contentType, encoding: "text" }
        : { body: readFileSync(filePath).toString("base64"), contentType, encoding: "base64" },
    ];
  });
}

try {
  assert(existsSync(distDir), "Run MICHELIN_BASE_PATH=/michelin/ npm run build first");
  assert(existsSync(databasePath), "Run npm run db:build first");
  assert(existsSync(blackPearlDatabasePath), "Run npm run db:build:black-pearl first");
  mkdirSync(outputDir, { recursive: true });

  const restaurants = readRestaurants(databasePath, RESTAURANTS_SQL);
  const blackPearlRestaurants = readRestaurants(blackPearlDatabasePath, BLACK_PEARL_RESTAURANTS_SQL);
  const apiPayload = {
    source: "sqlite",
    database: "database/michelin-restaurants.sqlite",
    count: restaurants.length,
    restaurants,
  };
  const blackPearlApiPayload = {
    source: "sqlite",
    database: "database/black-pearl-restaurants.sqlite",
    count: blackPearlRestaurants.length,
    restaurants: blackPearlRestaurants,
  };
  const assets = readAssets();

  const worker = `const DEPLOY_BASE = ${JSON.stringify(deployBase)};
const BLACK_PEARL_DEPLOY_BASE = ${JSON.stringify(blackPearlDeployBase)};
const API_PAYLOAD = ${JSON.stringify(apiPayload)};
const BLACK_PEARL_API_PAYLOAD = ${JSON.stringify(blackPearlApiPayload)};
const AMAP_CONFIG = ${JSON.stringify(amapConfig)};
const ASSETS = new Map(${JSON.stringify(assets)});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === DEPLOY_BASE) {
      return Response.redirect(new URL(DEPLOY_BASE + "/", url), 308);
    }

    if (url.pathname === BLACK_PEARL_DEPLOY_BASE) {
      return assetResponse("/index.html", ASSETS.get("/index.html"));
    }

    if (url.pathname.startsWith(BLACK_PEARL_DEPLOY_BASE + "/")) {
      const blackPearlLocalPath = url.pathname.slice(BLACK_PEARL_DEPLOY_BASE.length) || "/";
      if (blackPearlLocalPath === "/api/restaurants" || blackPearlLocalPath === "/api/black-pearl/restaurants") {
        return json(BLACK_PEARL_API_PAYLOAD, { "Cache-Control": "no-cache" });
      }

      if (blackPearlLocalPath === "/amap-config.json") {
        return json(AMAP_CONFIG, { "Cache-Control": "no-store" });
      }

      const blackPearlAsset = ASSETS.get(blackPearlLocalPath === "/" ? "/index.html" : blackPearlLocalPath);
      if (blackPearlAsset) return assetResponse(blackPearlLocalPath, blackPearlAsset);

      const accept = request.headers.get("Accept") || "";
      if (request.method === "GET" && accept.includes("text/html")) {
        return assetResponse("/index.html", ASSETS.get("/index.html"));
      }

      return new Response("Not found", { status: 404 });
    }

    if (!url.pathname.startsWith(DEPLOY_BASE + "/")) {
      return new Response("Not found", { status: 404 });
    }

    const localPath = url.pathname.slice(DEPLOY_BASE.length) || "/";

    if (localPath === "/api/restaurants") {
      return json(API_PAYLOAD, { "Cache-Control": "no-cache" });
    }

    if (localPath === "/api/black-pearl/restaurants") {
      return json(BLACK_PEARL_API_PAYLOAD, { "Cache-Control": "no-cache" });
    }

    if (localPath === "/amap-config.json") {
      return json(AMAP_CONFIG, { "Cache-Control": "no-store" });
    }

    const asset = ASSETS.get(localPath === "/" ? "/index.html" : localPath);
    if (asset) return assetResponse(localPath, asset);

    const accept = request.headers.get("Accept") || "";
    if (request.method === "GET" && accept.includes("text/html")) {
      return assetResponse("/index.html", ASSETS.get("/index.html"));
    }

    return new Response("Not found", { status: 404 });
  },
};

function json(value, headers = {}) {
  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function assetResponse(path, asset) {
  if (!asset) return new Response("Not found", { status: 404 });
  const immutable = path.startsWith("/assets/");
  const headers = {
    "Content-Type": asset.contentType,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  };
  const body = asset.encoding === "base64" ? base64ToBytes(asset.body) : asset.body;
  return new Response(body, { headers });
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
`;

  writeFileSync(outputPath, worker);
  console.log(
    `Cloudflare Worker built: ${outputPath} (${restaurants.length} Michelin restaurants, ${blackPearlRestaurants.length} Black Pearl restaurants, ${assets.length} assets).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
