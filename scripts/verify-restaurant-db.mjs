import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cwd, exit } from "node:process";

const root = cwd();
const databasePath = join(root, "database", "michelin-restaurants.sqlite");
const sourcePayloadPath = join(root, "output", "sources", "michelin-guide-china.json");
const restaurantsPath = join(root, "src", "data", "restaurants.ts");

const requiredColumns = [
  "cover_image",
  "name",
  "address",
  "latitude",
  "longitude",
  "coor_sys",
  "coordinate_source",
  "michelin_level",
  "michelin_price_band",
  "cuisine",
  "avg_price_cny",
  "recommended_dishes_json",
  "dianping_url",
  "dianping_app_shop_id",
  "dianping_app_url",
  "redirect_link",
  "michelin_source_url",
  "amap_maps_url",
  "amap_poi_query",
];

const removedColumns = [
  "cover_image_url",
  "cover_image_source",
  "lat",
  "lng",
  "cost_per_person_cny",
  "cost_source",
  "top_dishes_json",
  "top_dishes_source",
  "dianping_shop_id",
  "dianping_shop_uuid",
  "dianping_search_url",
  "dianping_match_name",
  "dianping_match_address",
  "dianping_match_score",
  "dianping_avg_price_cny",
  "dianping_recommended_dishes_json",
  "dianping_rating",
  "dianping_review_count",
  "dianping_fetch_status",
  "dianping_fetch_error",
  "dianping_fetched_at",
  "dianping_raw_path",
  "michelin_edition_url",
  "data_quality_note",
];

const confirmedShortDianpingDishIds = [
  "cn-fujian-province-ningde-ning-chuan-zu-yao-yu-wan",
  "cn-fujian-province-ningde-shou-ning-mi-gao",
  "cn-fujian-province-ningde-fu-ding-zheng-zong-bian-rou-jianxin-road",
  "cn-hong-kong-region-hong-kong-banh-mi-nem",
  "cn-macau-region-macau-sushi-kissho-by-miyakawa",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function query(sql) {
  const result = spawnSync("sqlite3", ["-json", databasePath, sql], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `sqlite3 query failed: ${sql}`);
  return JSON.parse(result.stdout || "[]");
}

function readExpectedRestaurants() {
  const source = readFileSync(restaurantsPath, "utf8");
  const jsonStart = source.indexOf("= [") + 2;
  const jsonEnd = source.lastIndexOf("];");
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

try {
  assert(existsSync(databasePath), "Run npm run db:build before database verification");
  assert(existsSync(sourcePayloadPath), "Run node scripts/fetch-michelin-data.mjs before database verification");
  assert(existsSync(restaurantsPath), "Expected src/data/restaurants.ts before database verification");
  const expectedRestaurants = readExpectedRestaurants();
  const expectedCityCounts = expectedRestaurants.reduce((counts, restaurant) => {
    counts[restaurant.city] = (counts[restaurant.city] ?? 0) + 1;
    return counts;
  }, {});

  const integrity = query("PRAGMA integrity_check;")[0]?.integrity_check;
  assert(integrity === "ok", `SQLite integrity check failed: ${integrity}`);

  const columns = query("PRAGMA table_info(restaurants);").map((column) => column.name);
  requiredColumns.forEach((column) => {
    assert(columns.includes(column), `restaurants table missing required field: ${column}`);
  });
  removedColumns.forEach((column) => {
    assert(!columns.includes(column), `restaurants table still has removed field: ${column}`);
  });

  const totals = query(`
    SELECT
      COUNT(*) AS rows,
      SUM(CASE WHEN cover_image IS NOT NULL THEN 1 ELSE 0 END) AS cover_rows,
      SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS coordinate_rows,
      SUM(CASE WHEN coor_sys = 'GCJ-02' THEN 1 ELSE 0 END) AS gcj_rows,
      SUM(CASE WHEN coordinate_source IN ('amap', 'michelin') THEN 1 ELSE 0 END) AS map_coordinate_rows,
      SUM(CASE WHEN avg_price_cny IS NOT NULL THEN 1 ELSE 0 END) AS avg_price_rows,
      SUM(CASE WHEN avg_price_cny IS NOT NULL AND dianping_url IS NULL THEN 1 ELSE 0 END) AS non_dianping_price_rows,
      SUM(CASE WHEN dianping_url IS NOT NULL THEN 1 ELSE 0 END) AS dianping_rows,
      SUM(CASE WHEN dianping_url IS NOT NULL AND (
        dianping_app_url LIKE 'https://link.dianping.com/universal-link?%'
        OR dianping_app_url LIKE 'https://m.dianping.com/shopshare/%'
      ) THEN 1 ELSE 0 END) AS dianping_app_link_rows,
      SUM(CASE WHEN dianping_app_url LIKE 'https://link.dianping.com/universal-link?%' THEN 1 ELSE 0 END) AS dianping_numeric_app_link_rows,
      SUM(CASE WHEN dianping_url IS NOT NULL AND dianping_app_url LIKE 'https://m.dianping.com/shopshare/%' THEN 1 ELSE 0 END) AS dianping_shopshare_app_link_rows,
      SUM(CASE WHEN dianping_app_shop_id IS NOT NULL THEN 1 ELSE 0 END) AS dianping_app_shop_id_rows,
      SUM(CASE WHEN dianping_url IS NULL AND dianping_app_shop_id IS NOT NULL THEN 1 ELSE 0 END) AS non_dianping_app_shop_id_rows,
      SUM(CASE WHEN dianping_app_shop_id IS NOT NULL AND dianping_app_shop_id GLOB '*[^0-9]*' THEN 1 ELSE 0 END) AS invalid_dianping_app_shop_id_rows,
      SUM(CASE WHEN dianping_app_shop_id IS NOT NULL AND dianping_app_url NOT LIKE 'https://link.dianping.com/universal-link?%' THEN 1 ELSE 0 END) AS app_shop_id_without_numeric_link_rows,
      SUM(CASE WHEN dianping_url IS NULL AND dianping_app_url IS NOT NULL AND dianping_app_shop_id IS NULL THEN 1 ELSE 0 END) AS non_dianping_app_link_without_id_rows,
      SUM(CASE WHEN dianping_url IS NULL AND dianping_app_url IS NOT NULL THEN 1 ELSE 0 END) AS non_dianping_app_link_rows,
      SUM(CASE WHEN dianping_url IS NOT NULL AND avg_price_cny IS NULL THEN 1 ELSE 0 END) AS dianping_url_only_rows,
      SUM(CASE WHEN dianping_url IS NOT NULL AND (
        avg_price_cny IS NULL
        OR (
          json_array_length(recommended_dishes_json) < 5
          AND id NOT IN (${confirmedShortDianpingDishIds.map((id) => `'${id}'`).join(", ")})
        )
      ) THEN 1 ELSE 0 END) AS incomplete_dianping_rows,
      SUM(CASE WHEN id IN (${confirmedShortDianpingDishIds.map((id) => `'${id}'`).join(", ")}) AND dianping_url IS NOT NULL AND avg_price_cny IS NOT NULL AND json_array_length(recommended_dishes_json) BETWEEN 1 AND 4 THEN 1 ELSE 0 END) AS confirmed_short_dianping_dish_rows,
      SUM(CASE WHEN dianping_url IS NOT NULL AND redirect_link = dianping_url THEN 1 ELSE 0 END) AS dianping_redirect_rows,
      SUM(CASE WHEN dianping_url IS NULL AND redirect_link = michelin_source_url THEN 1 ELSE 0 END) AS michelin_redirect_rows,
      SUM(CASE WHEN recommended_dishes_json IS NOT NULL THEN 1 ELSE 0 END) AS dish_json_rows,
      SUM(CASE WHEN json_array_length(recommended_dishes_json) <= 5 THEN 1 ELSE 0 END) AS top5_dish_rows,
      SUM(CASE WHEN redirect_link IS NOT NULL AND redirect_link <> '' THEN 1 ELSE 0 END) AS redirect_rows
    FROM restaurants;
  `)[0];

  assert(totals.rows === expectedRestaurants.length, `Expected ${expectedRestaurants.length} restaurant rows, got ${totals.rows}`);
  assert(totals.cover_rows === totals.rows, `Expected every restaurant to have a cover image, got ${totals.cover_rows}`);
  assert(totals.coordinate_rows === totals.rows, `Expected every restaurant to have latitude/longitude, got ${totals.coordinate_rows}`);
  assert(totals.gcj_rows === totals.rows, `Expected every restaurant to declare GCJ-02 coordinates, got ${totals.gcj_rows}`);
  assert(totals.map_coordinate_rows === totals.rows, `Expected every restaurant coordinate source to be map-ready, got ${totals.map_coordinate_rows}`);
  assert(totals.non_dianping_price_rows === 0, `Found ${totals.non_dianping_price_rows} non-Dianping avg_price_cny rows`);
  assert(
    totals.avg_price_rows <= totals.dianping_rows,
    `avg_price_cny rows ${totals.avg_price_rows} cannot exceed Dianping rows ${totals.dianping_rows}`,
  );
  assert(
    totals.dianping_url_only_rows === 0,
    `Found ${totals.dianping_url_only_rows} Dianping URL rows without avg_price_cny`,
  );
  assert(totals.dianping_app_link_rows === totals.dianping_rows, `Expected every Dianping row to have an app link, got ${totals.dianping_app_link_rows}`);
  assert(totals.dianping_app_shop_id_rows === totals.dianping_numeric_app_link_rows, `Expected numeric app links ${totals.dianping_numeric_app_link_rows} to match app shop IDs ${totals.dianping_app_shop_id_rows}`);
  assert(
    totals.invalid_dianping_app_shop_id_rows === 0,
    `Found ${totals.invalid_dianping_app_shop_id_rows} invalid Dianping app shop IDs`,
  );
  assert(
    totals.app_shop_id_without_numeric_link_rows === 0,
    `Found ${totals.app_shop_id_without_numeric_link_rows} app shop IDs without numeric app links`,
  );
  assert(
    totals.non_dianping_app_link_without_id_rows === 0,
    `Found ${totals.non_dianping_app_link_without_id_rows} non-Dianping app links without app shop IDs`,
  );
  assert(
    totals.incomplete_dianping_rows === 0,
    `Found ${totals.incomplete_dianping_rows} incomplete Dianping rows in DB`,
  );
  assert(
    totals.confirmed_short_dianping_dish_rows === confirmedShortDianpingDishIds.length,
    `Expected ${confirmedShortDianpingDishIds.length} confirmed short Dianping dish rows, got ${totals.confirmed_short_dianping_dish_rows}`,
  );
  assert(totals.dianping_redirect_rows === totals.dianping_rows, `Expected every Dianping row to redirect to Dianping, got ${totals.dianping_redirect_rows}`);
  assert(
    totals.michelin_redirect_rows === totals.rows - totals.dianping_rows,
    `Expected non-Dianping rows to redirect to MICHELIN, got ${totals.michelin_redirect_rows}`,
  );
  assert(totals.dish_json_rows === totals.rows, `Expected every restaurant to have recommended dish JSON, got ${totals.dish_json_rows}`);
  assert(totals.top5_dish_rows === totals.rows, `Expected every recommended dish list to be top5 or smaller, got ${totals.top5_dish_rows}`);
  assert(totals.redirect_rows === totals.rows, `Expected every restaurant to have redirect_link, got ${totals.redirect_rows}`);

  const cityCounts = query(`
    SELECT city_code, COUNT(*) AS rows
    FROM restaurants
    GROUP BY city_code
    ORDER BY city_code;
  `);
  cityCounts.forEach((city) => {
    assert(city.rows === expectedCityCounts[city.city_code], `${city.city_code} row mismatch: ${city.rows}`);
  });

  console.log(
    `Restaurant database verification passed: ${totals.rows} rows, ${totals.dianping_rows} complete/confirmed Dianping rows, ${totals.avg_price_rows} Dianping avg-price rows, ${totals.dianping_app_shop_id_rows} Dianping app shop IDs, ${totals.dianping_numeric_app_link_rows} numeric Dianping app links, ${totals.dianping_shopshare_app_link_rows} shopshare app-link fallbacks, ${totals.non_dianping_app_shop_id_rows} app-link-only rows, ${totals.dianping_url_only_rows} Dianping URL-only rows, ${totals.incomplete_dianping_rows} incomplete Dianping rows, ${totals.confirmed_short_dianping_dish_rows} confirmed short dish rows, MICHELIN fallback rows=${totals.rows - totals.dianping_rows}, compact fields, MICHELIN covers, GCJ-02 latitude/longitude, city counts valid.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
