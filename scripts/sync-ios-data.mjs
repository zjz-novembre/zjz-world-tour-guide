import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const outputDir = join(root, "ios", "LiteDineGuideDemo", "LiteDineGuideDemo", "Data");

const guides = [
  {
    guide: "michelin",
    database: "database/michelin-restaurants.sqlite",
    output: "michelin-restaurants.json",
    levelColumn: "michelin_level",
    priceColumn: "michelin_price_band",
    sourceColumn: "michelin_source_url",
  },
  {
    guide: "blackPearl",
    database: "database/black-pearl-restaurants.sqlite",
    output: "black-pearl-restaurants.json",
    levelColumn: "black_pearl_level",
    priceColumn: "black_pearl_price_display",
    sourceColumn: "black_pearl_source_url",
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readRows(config) {
  const sql = `
    SELECT
      id,
      name,
      city_code AS city,
      city_name AS cityName,
      province,
      country,
      district,
      ${config.levelColumn} AS level,
      avg_price_cny AS avgPrice,
      ${config.priceColumn} AS michelinPrice,
      recommended_dishes_json AS dishesJson,
      longitude,
      latitude,
      cover_image AS coverImageUrl,
      redirect_link AS redirectUrl,
      dianping_app_shop_id AS dianpingAppShopId,
      dianping_app_url AS dianpingAppUrl,
      ${config.sourceColumn} AS sourceUrl
    FROM restaurants
    ORDER BY city_name COLLATE NOCASE, name COLLATE NOCASE;
  `;
  const result = spawnSync("sqlite3", ["-json", config.database, sql], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert(result.status === 0, result.stderr || `sqlite3 failed for ${config.database}`);
  return JSON.parse(result.stdout || "[]");
}

function mapRestaurant(config, row) {
  const dishes = JSON.parse(row.dishesJson || "[]");
  assert(Array.isArray(dishes), `${row.name} has invalid dishes JSON`);
  return {
    id: row.id,
    name: row.name,
    guide: config.guide,
    city: row.city,
    cityName: row.cityName,
    province: row.province,
    country: row.country,
    district: row.district ?? "",
    level: row.level,
    ...(typeof row.avgPrice === "number" ? { avgPrice: row.avgPrice } : {}),
    michelinPrice: row.michelinPrice ?? "",
    dishes,
    longitude: Number(row.longitude),
    latitude: Number(row.latitude),
    ...(row.coverImageUrl ? { coverImageUrl: row.coverImageUrl } : {}),
    ...(row.redirectUrl ? { redirectUrl: row.redirectUrl } : {}),
    ...(row.dianpingAppShopId ? { dianpingAppShopId: String(row.dianpingAppShopId) } : {}),
    ...(row.dianpingAppUrl ? { dianpingAppUrl: row.dianpingAppUrl } : {}),
    sourceUrl: row.sourceUrl,
  };
}

function readExistingOrder(outputPath) {
  if (!existsSync(outputPath)) return new Map();
  const records = JSON.parse(readFileSync(outputPath, "utf8"));
  assert(Array.isArray(records), `${outputPath} is not a JSON array`);
  return new Map(records.map((record, index) => [record.id, index]));
}

function sortLikeExisting(restaurants, existingOrder) {
  if (!existingOrder.size) return restaurants;
  return restaurants.sort((left, right) => {
    const leftIndex = existingOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = existingOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

try {
  mkdirSync(outputDir, { recursive: true });
  for (const config of guides) {
    const outputPath = join(outputDir, config.output);
    const restaurants = sortLikeExisting(
      readRows(config).map((row) => mapRestaurant(config, row)),
      readExistingOrder(outputPath),
    );
    writeFileSync(outputPath, JSON.stringify(restaurants));
    console.log(`iOS data synced: ${outputPath} (${restaurants.length} rows).`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
