import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cwd, exit } from "node:process";

const root = cwd();
const databaseDir = join(root, "database");
const databasePath = join(databaseDir, "black-pearl-restaurants.sqlite");
const schemaPath = join(databaseDir, "black-pearl-schema.sql");
const sourcePath = join(root, "output", "sources", "black-pearl-guide.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sql(value) {
  if (value === undefined || value === null || value === "") return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dianpingShopId(url) {
  if (!url) return null;
  return String(url).match(/\/shop\/([^/?#]+)/)?.[1] ?? null;
}

function dianpingAppShopId(record) {
  const value = record?.dianpingAppShopId ?? record?.dianpingNumericShopId;
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function numericDianpingAppUrl(record) {
  const appShopId = dianpingAppShopId(record);
  const shopUuid = dianpingShopId(record?.dianpingUrl);
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

function readRecords() {
  assert(existsSync(sourcePath), "Run npm run data:black-pearl before building the Black Pearl DB");
  const payload = JSON.parse(readFileSync(sourcePath, "utf8"));
  assert(Array.isArray(payload.records), "Black Pearl source is missing records[]");
  return payload.records;
}

function insertRestaurant(restaurant) {
  const [longitude, latitude] = restaurant.position ?? [null, null];
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`${restaurant.name} is missing map-ready coordinates`);
  }

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
    "black_pearl_level",
    "black_pearl_diamond",
    "black_pearl_price_display",
    "cuisine",
    "avg_price_cny",
    "recommended_dishes_json",
    "dianping_url",
    "dianping_app_shop_id",
    "dianping_app_url",
    "redirect_link",
    "black_pearl_source_url",
    "black_pearl_shop_id",
    "black_pearl_name",
    "matched_michelin_id",
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
    restaurant.coorSys ?? "GCJ-02",
    restaurant.coordinateSource,
    restaurant.level,
    restaurant.diamondLevel,
    restaurant.blackPearlPriceDisplay,
    restaurant.cuisine,
    restaurant.avgPriceCny,
    JSON.stringify(restaurant.topDishes ?? []),
    restaurant.dianpingUrl,
    dianpingAppShopId(restaurant),
    numericDianpingAppUrl(restaurant) ?? restaurant.dianpingAppUrl,
    restaurant.redirectLink,
    restaurant.blackPearlSourceUrl,
    restaurant.blackPearlShopId,
    restaurant.blackPearlName,
    restaurant.matchedMichelinId,
    restaurant.michelinSourceUrl,
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

  const records = readRecords();
  const schema = readFileSync(schemaPath, "utf8");
  const sqlInput = [schema, "BEGIN;", ...records.map(insertRestaurant), "COMMIT;"].join("\n");
  const result = spawnSync("sqlite3", [databasePath], {
    cwd: root,
    input: sqlInput,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || "sqlite3 failed to build the Black Pearl database");
  }

  console.log(`Black Pearl database built: ${databasePath} (${records.length} rows).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
