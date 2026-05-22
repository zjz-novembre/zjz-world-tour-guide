import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const sourcePath = join(root, "src", "data", "restaurants.ts");
const guideSourcePath = join(root, "output", "sources", "michelin-guide-china.json");
const coverMetadataPath = join(root, "output", "sources", "michelin-cover-images.json");
const outputPath = join(root, "output", "sources", "amap-coordinate-refresh.json");

const CHINA_MIN_LNG = 72.004;
const CHINA_MAX_LNG = 137.8347;
const CHINA_MIN_LAT = 0.8293;
const CHINA_MAX_LAT = 55.8271;
const EARTH_AXIS = 6378245.0;
const ECCENTRICITY = 0.006693421622965943;

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
    return [key, valueParts.length ? valueParts.join("=") : "true"];
  }),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readRestaurants() {
  const source = readFileSync(sourcePath, "utf8");
  const jsonStart = source.indexOf("= [") + 2;
  const jsonEnd = source.lastIndexOf("];");
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

function writeRestaurants(records) {
  writeFileSync(
    sourcePath,
    `import type { Restaurant } from "../types";

export const restaurants: Restaurant[] = ${JSON.stringify(records, null, 2)};
`,
  );
}

function readGuideRecords() {
  const payload = JSON.parse(readFileSync(guideSourcePath, "utf8"));
  assert(Array.isArray(payload.records), "MICHELIN China source payload is missing records[]");
  return payload.records;
}

function readCoverPositions() {
  const payload = JSON.parse(readFileSync(coverMetadataPath, "utf8"));
  const records = Array.isArray(payload.records) ? payload.records : [];
  return new Map(
    records
      .filter((record) => record.href && isPosition(record.michelinPosition))
      .map((record) => [record.href, record.michelinPosition]),
  );
}

function isPosition(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function amapSearch(name, cityName) {
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(`${name} ${cityName}`)}`;
}

function wgs84ToGcj02(position) {
  const [longitude, latitude] = position;

  if (isOutsideChina(longitude, latitude)) {
    return position;
  }

  let dLat = transformLatitude(longitude - 105.0, latitude - 35.0);
  let dLng = transformLongitude(longitude - 105.0, latitude - 35.0);
  const radLat = (latitude / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ECCENTRICITY * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat = (dLat * 180.0) / (((EARTH_AXIS * (1 - ECCENTRICITY)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((EARTH_AXIS / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return [roundCoordinate(longitude + dLng), roundCoordinate(latitude + dLat)];
}

function isOutsideChina(longitude, latitude) {
  return (
    longitude < CHINA_MIN_LNG ||
    longitude > CHINA_MAX_LNG ||
    latitude < CHINA_MIN_LAT ||
    latitude > CHINA_MAX_LAT
  );
}

function transformLatitude(x, y) {
  let result =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  result += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  result += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  result += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return result;
}

function transformLongitude(x, y) {
  let result =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  result += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  result += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  result += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return result;
}

function roundCoordinate(value) {
  return Number(value.toFixed(12));
}

function distanceMeters(left, right) {
  const [lng1, lat1] = left;
  const [lng2, lat2] = right;
  const toRad = (value) => (value * Math.PI) / 180;
  const radius = 6371008.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function main() {
  const dryRun = args.get("dry-run") === "true";
  const restaurants = readRestaurants();
  const guideRecords = readGuideRecords();
  const coverPositions = readCoverPositions();
  const guideById = new Map(guideRecords.map((record) => [record.id, record]));
  const guideBySourceUrl = new Map(guideRecords.map((record) => [record.sourceUrl, record]));

  const diagnostics = [];
  const nextRestaurants = restaurants.map((restaurant) => {
    const guideRecord = guideById.get(restaurant.id) ?? guideBySourceUrl.get(restaurant.sourceUrl);
    const sourcePosition = coverPositions.get(restaurant.sourceUrl) ?? guideRecord?.position;
    assert(isPosition(sourcePosition), `${restaurant.name} missing MICHELIN source coordinate`);

    const position = wgs84ToGcj02(sourcePosition);
    const { amapPoiId: _amapPoiId, ...rest } = restaurant;
    diagnostics.push({
      id: restaurant.id,
      name: restaurant.name,
      city: restaurant.city,
      method: "local-wgs84-to-gcj02",
      sourcePosition,
      source: coverPositions.has(restaurant.sourceUrl)
        ? "michelin-detail-cover-metadata"
        : "michelin-guide-china",
      previousPosition: restaurant.position,
      position,
      movementMeters: restaurant.position ? distanceMeters(restaurant.position, position) : null,
    });

    return {
      ...rest,
      position,
      coorSys: "GCJ-02",
      coordinateSystem: "GCJ-02",
      coordinateSource: "michelin",
      mapsUrl: amapSearch(restaurant.name, restaurant.cityName),
    };
  });

  mkdirSync(join(root, "output", "sources"), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        source: "MICHELIN Guide WGS-84 coordinates converted locally to GCJ-02 for AMap display",
        mode: "convert",
        dryRun,
        count: nextRestaurants.length,
        sourceCounts: diagnostics.reduce((acc, item) => {
          acc[item.source] = (acc[item.source] ?? 0) + 1;
          return acc;
        }, {}),
        diagnostics,
      },
      null,
      2,
    )}\n`,
  );

  if (!dryRun) {
    writeRestaurants(nextRestaurants);
    console.log(`[write] ${sourcePath}`);
  }

  console.log(`[write] ${outputPath}`);
  console.log(`[summary] converted=${nextRestaurants.length}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
