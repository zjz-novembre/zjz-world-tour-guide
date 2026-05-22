import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";

const root = cwd();
const source = readFileSync(join(root, "src/data/restaurants.ts"), "utf8");
const options = readFileSync(join(root, "src/data/options.ts"), "utf8");
const sourcePayloadPath = join(root, "output", "sources", "michelin-guide-china.json");
const jsonStart = source.indexOf("= [") + 2;
const jsonEnd = source.lastIndexOf("];");
const restaurants = JSON.parse(source.slice(jsonStart, jsonEnd + 1));
const sourcePayload = existsSync(sourcePayloadPath)
  ? JSON.parse(readFileSync(sourcePayloadPath, "utf8"))
  : null;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] ?? 0) + 1;
    return acc;
  }, {});
}

const ids = restaurants.map((restaurant) => restaurant.id);
const cityCounts = countBy(restaurants, "city");
assert(new Set(ids).size === ids.length, "Restaurant ids must be unique");
assert(restaurants.length >= 1000, `Expected China-wide dataset, got only ${restaurants.length} restaurants`);

if (sourcePayload) {
  assert(
    restaurants.length === sourcePayload.total,
    `Source JSON total ${sourcePayload.total} does not match restaurants.ts ${restaurants.length}`,
  );
  Object.entries(sourcePayload.cityCounts).forEach(([city, count]) => {
    assert(cityCounts[city] === count, `${city} source count ${count} != restaurants.ts ${cityCounts[city]}`);
  });
}

Object.keys(cityCounts).forEach((city) => {
  assert(options.includes(`value: "${city}"`), `Missing city option for ${city}`);
});

restaurants.forEach((restaurant) => {
  assert(restaurant.name, "Restaurant missing name");
  assert(restaurant.city && restaurant.cityName, `${restaurant.name} missing city`);
  assert(restaurant.province && restaurant.country, `${restaurant.name} missing province/country`);
  assert(restaurant.country === "中国", `${restaurant.name} country must be 中国`);
  assert(restaurant.mapsUrl.startsWith("https://uri.amap.com/search?keyword="), `${restaurant.name} missing AMap URL`);
  assert(restaurant.sourceUrl.startsWith("https://guide.michelin.com/"), `${restaurant.name} missing MICHELIN source URL`);
  assert(restaurant.sourceEditionUrl?.startsWith("https://"), `${restaurant.name} missing edition source URL`);
  assert(
    restaurant.coverImageUrl?.includes("cloudimg.io") && restaurant.coverImageUrl.includes("__gmpics"),
    `${restaurant.name} missing official MICHELIN cover image`,
  );
  assert(restaurant.michelinPrice, `${restaurant.name} missing MICHELIN price band`);
  assert(!("costPerPersonCny" in restaurant), `${restaurant.name} must not store MICHELIN-symbol price estimates as avg cost`);
  assert(Array.isArray(restaurant.topDishes), `${restaurant.name} topDishes must be an array`);
  assert(restaurant.topDishes.length <= 5, `${restaurant.name} topDishes must be top5 or smaller`);
  assert(restaurant.coorSys === "GCJ-02", `${restaurant.name} must declare GCJ-02 coordinates`);
  assert(
    ["amap", "michelin"].includes(restaurant.coordinateSource),
    `${restaurant.name} must declare a vetted coordinate source`,
  );
  assert(Array.isArray(restaurant.position), `${restaurant.name} missing stored position`);
  const [lng, lat] = restaurant.position;
  assert(lng > 72 && lng < 138, `${restaurant.name} longitude outside China bounds: ${lng}`);
  assert(lat > 0.8 && lat < 56, `${restaurant.name} latitude outside China bounds: ${lat}`);
});

console.log(
  `Data verification passed: ${restaurants.length} official MICHELIN China restaurants, ${Object.keys(cityCounts).length} cities, Chinese-localized source fields, MICHELIN covers, vetted GCJ-02 positions, and no synthetic avg-cost estimates.`,
);
