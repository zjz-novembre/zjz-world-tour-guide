import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative } from "node:path";

type NextFunction = (error?: unknown) => void;

type DbRestaurantRow = {
  id: string;
  name: string;
  englishName: string | null;
  city: string;
  cityName: string;
  province: string;
  country: string;
  district: string | null;
  address: string | null;
  level: string;
  avgPriceCny: number | null;
  michelinPrice: string | null;
  recommendedDishesJson: string;
  dianpingUrl: string | null;
  dianpingAppShopId: string | null;
  dianpingAppUrl: string | null;
  cuisine: string | null;
  poiQuery: string | null;
  longitude: number;
  latitude: number;
  coorSys: "GCJ-02";
  coordinateSystem: "GCJ-02";
  coordinateSource: "amap" | "michelin" | "manual";
  amapPoiId: string | null;
  mapsUrl: string | null;
  coverImageUrl: string | null;
  sourceUrl: string;
};

type ApiRestaurant = {
  id: string;
  name: string;
  englishName?: string;
  city: string;
  cityName: string;
  province: string;
  country: string;
  district: string;
  address?: string;
  level: string;
  costPerPersonCny?: number;
  michelinPrice: string;
  topDishes: string[];
  dianpingUrl?: string;
  dianpingAppShopId?: string;
  dianpingAppUrl?: string;
  dianpingAvgPriceCny?: number;
  dianpingRecommendedDishes: string[];
  cuisine: string;
  poiQuery: string;
  position: [number, number];
  coorSys: "GCJ-02";
  coordinateSystem: "GCJ-02";
  coordinateSource: "amap" | "michelin" | "manual";
  amapPoiId?: string;
  mapsUrl: string;
  coverImageUrl?: string;
  sourceUrl: string;
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

export function createRestaurantsApi(root: string) {
  const databasePath = join(root, "database", "michelin-restaurants.sqlite");
  const blackPearlDatabasePath = join(root, "database", "black-pearl-restaurants.sqlite");
  const databaseLabel = relative(root, databasePath);
  const blackPearlDatabaseLabel = relative(root, blackPearlDatabasePath);

  return function restaurantsApi(
    request: IncomingMessage,
    response: ServerResponse,
    next: NextFunction,
  ) {
    if (request.method !== "GET") {
      next();
      return;
    }

    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    const isMichelinApi = url.pathname === "/api/restaurants";
    const isBlackPearlApi = url.pathname === "/api/black-pearl/restaurants";

    if (!isMichelinApi && !isBlackPearlApi) {
      next();
      return;
    }

    const activeDatabasePath = isBlackPearlApi ? blackPearlDatabasePath : databasePath;
    const activeDatabaseLabel = isBlackPearlApi ? blackPearlDatabaseLabel : databaseLabel;
    const activeSql = isBlackPearlApi ? BLACK_PEARL_RESTAURANTS_SQL : RESTAURANTS_SQL;

    try {
      const restaurants = readRestaurants(activeDatabasePath, activeSql);
      sendJson(response, 200, {
        source: "sqlite",
        database: activeDatabaseLabel,
        count: restaurants.length,
        restaurants,
      });
    } catch (error) {
      sendJson(response, 500, {
        source: "sqlite",
        database: activeDatabaseLabel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function readRestaurants(databasePath: string, sql: string): ApiRestaurant[] {
  if (!existsSync(databasePath)) {
    throw new Error(`Restaurant database does not exist: ${databasePath}`);
  }

  const result = spawnSync("sqlite3", ["-json", databasePath, sql], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "sqlite3 failed to read restaurants");
  }

  const rows = JSON.parse(result.stdout || "[]") as DbRestaurantRow[];
  return rows.map(mapRestaurant);
}

function mapRestaurant(row: DbRestaurantRow): ApiRestaurant {
  const longitude = Number(row.longitude);
  const latitude = Number(row.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`${row.name} has invalid map coordinates`);
  }
  const recommendedDishes = parseStringList(row.recommendedDishesJson, row.name);

  return {
    id: row.id,
    name: row.name,
    ...(row.englishName ? { englishName: row.englishName } : {}),
    city: row.city,
    cityName: row.cityName,
    province: row.province,
    country: row.country,
    district: row.district ?? "",
    ...(row.address ? { address: row.address } : {}),
    level: row.level,
    ...(typeof row.avgPriceCny === "number" ? { costPerPersonCny: row.avgPriceCny } : {}),
    michelinPrice: row.michelinPrice ?? "",
    topDishes: recommendedDishes,
    ...(row.dianpingUrl ? { dianpingUrl: row.dianpingUrl } : {}),
    ...(row.dianpingAppShopId ? { dianpingAppShopId: row.dianpingAppShopId } : {}),
    ...(row.dianpingAppUrl ? { dianpingAppUrl: row.dianpingAppUrl } : {}),
    ...(row.dianpingUrl && typeof row.avgPriceCny === "number" ? { dianpingAvgPriceCny: row.avgPriceCny } : {}),
    dianpingRecommendedDishes: row.dianpingUrl ? recommendedDishes : [],
    cuisine: row.cuisine ?? "",
    poiQuery: row.poiQuery ?? row.name,
    position: [longitude, latitude],
    coorSys: row.coorSys,
    coordinateSystem: row.coordinateSystem,
    coordinateSource: row.coordinateSource,
    ...(row.amapPoiId ? { amapPoiId: row.amapPoiId } : {}),
    mapsUrl: row.mapsUrl ?? row.sourceUrl,
    ...(row.coverImageUrl ? { coverImageUrl: row.coverImageUrl } : {}),
    sourceUrl: row.sourceUrl,
  };
}

function parseStringList(json: string, name: string): string[] {
  const parsed = JSON.parse(json || "[]") as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`${name} has invalid top dishes JSON`);
  }

  return parsed;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache");
  response.end(body);
}
