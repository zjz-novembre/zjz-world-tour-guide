import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cwd, exit } from "node:process";

const root = cwd();
const databaseDir = join(root, "database");
const databasePath = join(databaseDir, "michelin-restaurants.sqlite");
const schemaPath = join(databaseDir, "schema.sql");
const dianpingPath = join(root, "output", "sources", "dianping-enrichment.json");

function readRestaurants() {
  const source = readFileSync(join(root, "src/data/restaurants.ts"), "utf8");
  const jsonStart = source.indexOf("= [") + 2;
  const jsonEnd = source.lastIndexOf("];");
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

function readDianpingRecords() {
  if (!existsSync(dianpingPath)) return {};
  const payload = JSON.parse(readFileSync(dianpingPath, "utf8"));
  return payload.records ?? {};
}

function isCompleteDianpingRecord(record) {
  const dishes = Array.isArray(record?.recommendedDishes)
    ? record.recommendedDishes.filter((dish) => typeof dish === "string" && dish.trim()).slice(0, 5)
    : [];
  const requiredDishes = record?.acceptShortRecommendedDishes === true ? 1 : 5;
  return Boolean(record?.url && Number.isFinite(record?.avgPriceCny) && dishes.length >= requiredDishes);
}

function dianpingShopId(url) {
  if (!url) return null;
  return String(url).match(/\/shop\/([^/?#]+)/)?.[1] ?? null;
}

function dianpingAppUrl(url) {
  const shopId = dianpingShopId(url);
  if (!shopId) return null;
  return `https://m.dianping.com/shopshare/${encodeURIComponent(shopId)}`;
}

function dianpingAppShopId(record) {
  const value = record?.dianpingAppShopId ?? record?.dianpingNumericShopId;
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function numericDianpingAppUrl(record) {
  const appShopId = dianpingAppShopId(record);
  const shopUuid = dianpingShopId(record?.url);
  if (!appShopId || !shopUuid) return null;
  if (
    typeof record.dianpingAppUrl === "string" &&
    record.dianpingAppUrl.startsWith("https://link.dianping.com/universal-link?") &&
    record.dianpingAppUrl.includes(encodeURIComponent(`shopinfo?id=${appShopId}`))
  ) {
    return record.dianpingAppUrl;
  }
  const originalUrl = `https://m.dianping.com/shop/${encodeURIComponent(shopUuid)}`;
  const schema = `dianping://shopinfo?id=${encodeURIComponent(appShopId)}&utm=w_mshop_auto`;
  return `https://link.dianping.com/universal-link?originalUrl=${encodeURIComponent(originalUrl)}&schema=${encodeURIComponent(schema)}`;
}

function sql(value) {
  if (value === undefined || value === null || value === "") return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertRestaurant(restaurant, dianpingRecords) {
  const candidateDianping = dianpingRecords[restaurant.id];
  const dianping = isCompleteDianpingRecord(candidateDianping) ? candidateDianping : {};
  const appShopId = dianpingAppShopId(candidateDianping);
  const appUrl = appShopId
    ? numericDianpingAppUrl(candidateDianping)
    : dianping.dianpingAppUrl || dianpingAppUrl(dianping.url);
  if (!restaurant.province || !restaurant.country) {
    throw new Error(`${restaurant.name} is missing city/province/country metadata`);
  }

  const [longitude, latitude] = restaurant.position ?? [null, null];
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`${restaurant.name} is missing map-ready coordinates`);
  }

  const coorSys = restaurant.coorSys ?? restaurant.coordinateSystem ?? "GCJ-02";
  const coordinateSource = restaurant.coordinateSource ?? "amap";
  const dianpingDishes = Array.isArray(dianping.recommendedDishes)
    ? dianping.recommendedDishes.filter((dish) => typeof dish === "string").slice(0, 5)
    : [];
  const restaurantDishes = Array.isArray(restaurant.topDishes)
    ? restaurant.topDishes.filter((dish) => typeof dish === "string").slice(0, 5)
    : [];
  const recommendedDishes = dianpingDishes.length ? dianpingDishes : restaurantDishes;
  const avgPrice = Number.isFinite(dianping.avgPriceCny) ? Math.round(dianping.avgPriceCny) : null;
  const columns = [
    "id",
    "cover_image",
    "name",
    "english_name",
    "city_code",
    "city_name",
    "province",
    "country",
    "district",
    "address",
    "latitude",
    "longitude",
    "coor_sys",
    "coordinate_source",
    "michelin_price_band",
    "michelin_level",
    "cuisine",
    "avg_price_cny",
    "recommended_dishes_json",
    "dianping_url",
    "dianping_app_shop_id",
    "dianping_app_url",
    "redirect_link",
    "michelin_source_url",
    "amap_poi_id",
    "amap_maps_url",
    "amap_poi_query",
  ];
  const values = [
    restaurant.id,
    restaurant.coverImageUrl,
    restaurant.name,
    restaurant.englishName,
    restaurant.city,
    restaurant.cityName,
    restaurant.province,
    restaurant.country,
    restaurant.district,
    restaurant.address,
    latitude,
    longitude,
    coorSys,
    coordinateSource,
    restaurant.michelinPrice,
    restaurant.level,
    restaurant.cuisine,
    avgPrice,
    JSON.stringify(recommendedDishes),
    dianping.url,
    appShopId,
    appUrl,
    dianping.url || restaurant.sourceUrl,
    restaurant.sourceUrl,
    restaurant.amapPoiId,
    restaurant.mapsUrl,
    restaurant.poiQuery,
  ];

  return `INSERT INTO restaurants (${columns.join(", ")}) VALUES (${values
    .map(sql)
    .join(", ")});`;
}

try {
  mkdirSync(databaseDir, { recursive: true });
  rmSync(databasePath, { force: true });

  const restaurants = readRestaurants();
  const dianpingRecords = readDianpingRecords();
  const schema = readFileSync(schemaPath, "utf8");
  const sqlInput = [
    schema,
    "BEGIN;",
    ...restaurants.map((restaurant) => insertRestaurant(restaurant, dianpingRecords)),
    "COMMIT;",
  ].join("\n");

  const result = spawnSync("sqlite3", [databasePath], {
    cwd: root,
    input: sqlInput,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || "sqlite3 failed to build the restaurant database");
  }

  console.log(`Restaurant database built: ${databasePath} (${restaurants.length} rows).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
