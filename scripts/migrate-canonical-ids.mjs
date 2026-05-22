import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const restaurantsPath = join(root, "src", "data", "restaurants.ts");
const enrichmentPath = join(root, "output", "sources", "dianping-enrichment.json");
const legacyPath = join(root, "output", "sources", "michelin-guide-four-cities.json");
const chinaSourcePath = join(root, "output", "sources", "michelin-guide-china.json");
const reportPath = join(root, "output", "sources", "dianping-canonical-id-migration.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readRestaurantsTs() {
  const source = readFileSync(restaurantsPath, "utf8");
  const jsonStart = source.indexOf("= [") + 2;
  const jsonEnd = source.lastIndexOf("];");
  assert(jsonStart >= 2 && jsonEnd >= 0, "Could not parse restaurants.ts");
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

function writeRestaurantsTs(records) {
  writeFileSync(
    restaurantsPath,
    `import type { Restaurant } from "../types";\n\nexport const restaurants: Restaurant[] = ${JSON.stringify(records, null, 2)};\n`,
  );
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, payload) {
  mkdirSync(join(root, "output", "sources"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function slugPart(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sourceParts(sourceUrl) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const restaurantIndex = parts.indexOf("restaurant");
  assert(restaurantIndex >= 0, `MICHELIN source URL has no restaurant segment: ${sourceUrl}`);
  const province = parts[2];
  const city = parts[3];
  const restaurantSlug = parts[restaurantIndex + 1];
  assert(province && city && restaurantSlug, `MICHELIN source URL is missing canonical parts: ${sourceUrl}`);
  return { province, city, restaurantSlug, restaurantPath: parts.slice(restaurantIndex).join("/") };
}

function canonicalId(record) {
  const parts = sourceParts(record.sourceUrl);
  return ["cn", parts.province, parts.city, parts.restaurantSlug].map(slugPart).filter(Boolean).join("-");
}

function michelinRestaurantPath(sourceUrl) {
  try {
    return sourceParts(sourceUrl).restaurantPath;
  } catch {
    return "";
  }
}

function normalizeRestaurantName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[·・.,，。!！?？'’"“”\-—–_:：;；/\\|]/g, "");
}

function withoutBranch(value) {
  return String(value ?? "").replace(/[（(][^（）()]*[）)]/g, "").trim();
}

function normalizedNameKeys(value) {
  return [...new Set([normalizeRestaurantName(value), normalizeRestaurantName(withoutBranch(value))])].filter(Boolean);
}

function isCompleteDianpingRecord(record) {
  const dishes = Array.isArray(record?.recommendedDishes)
    ? record.recommendedDishes.filter((dish) => typeof dish === "string" && dish.trim()).slice(0, 5)
    : [];
  return Boolean(record?.url && Number.isFinite(record?.avgPriceCny) && dishes.length >= 5);
}

function recordScore(record) {
  if (!record) return 0;
  const dishCount = Array.isArray(record.recommendedDishes) ? record.recommendedDishes.length : 0;
  return (isCompleteDianpingRecord(record) ? 1000 : 0) +
    (record.url ? 100 : 0) +
    (Number.isFinite(record.avgPriceCny) ? 100 : 0) +
    Math.min(dishCount, 5);
}

function sanitizeRecord(record) {
  const recommendedDishes = Array.isArray(record?.recommendedDishes)
    ? [...new Set(record.recommendedDishes.map((dish) => String(dish).trim()).filter(Boolean))].slice(0, 5)
    : [];
  return {
    ...(Number.isFinite(record?.avgPriceCny) ? { avgPriceCny: Math.round(record.avgPriceCny) } : {}),
    ...(recommendedDishes.length ? { recommendedDishes } : {}),
    ...(record?.url ? { url: record.url } : {}),
  };
}

function sameRecord(left, right) {
  return JSON.stringify(sanitizeRecord(left)) === JSON.stringify(sanitizeRecord(right));
}

function chooseRecord(existing, incoming) {
  if (!existing) return { record: incoming.record, reason: "first" };
  const existingScore = recordScore(existing.record);
  const incomingScore = recordScore(incoming.record);
  if (incomingScore > existingScore) return { record: incoming.record, reason: "higher-score" };
  if (incomingScore < existingScore) return { record: existing.record, reason: "kept-higher-score" };
  if (incoming.origin === "current-id" && existing.origin !== "current-id") {
    return { record: incoming.record, reason: "prefer-current-id" };
  }
  return { record: existing.record, reason: "kept-existing" };
}

function buildCurrentLookups(restaurants) {
  const oldIdToCanonical = new Map();
  const canonicalIds = new Set();
  const byPath = new Map();
  const byCityName = new Map();
  const collisions = [];

  for (const restaurant of restaurants) {
    const nextId = canonicalId(restaurant);
    if (canonicalIds.has(nextId)) collisions.push(nextId);
    canonicalIds.add(nextId);
    oldIdToCanonical.set(restaurant.id, nextId);
    byPath.set(michelinRestaurantPath(restaurant.sourceUrl), nextId);
    for (const nameKey of normalizedNameKeys(restaurant.name)) {
      byCityName.set(`${restaurant.city}:${nameKey}`, nextId);
    }
  }

  return { oldIdToCanonical, canonicalIds, byPath, byCityName, collisions };
}

function resolveRecordId(id, lookups, legacyById) {
  if (lookups.canonicalIds.has(id)) return { targetId: id, origin: "canonical-id" };
  if (lookups.oldIdToCanonical.has(id)) return { targetId: lookups.oldIdToCanonical.get(id), origin: "current-id" };

  const legacy = legacyById.get(id);
  if (legacy) {
    const byPath = lookups.byPath.get(michelinRestaurantPath(legacy.sourceUrl));
    if (byPath) return { targetId: byPath, origin: "legacy-source-url" };
    for (const nameKey of normalizedNameKeys(legacy.name)) {
      const byName = lookups.byCityName.get(`${legacy.city}:${nameKey}`);
      if (byName) return { targetId: byName, origin: "legacy-city-name" };
    }
  }

  return { targetId: "", origin: "unmatched" };
}

function updateChinaSourceIds(idMap) {
  if (!existsSync(chinaSourcePath)) return;
  const payload = readJson(chinaSourcePath, {});
  if (!Array.isArray(payload.records)) return;
  payload.records = payload.records.map((record) => ({
    ...record,
    id: idMap.get(record.id) ?? canonicalId(record),
  }));
  writeJson(chinaSourcePath, payload);
}

try {
  const restaurants = readRestaurantsTs();
  const enrichmentPayload = readJson(enrichmentPath, { records: {} });
  const legacyPayload = readJson(legacyPath, { records: [] });
  const legacyRecords = Array.isArray(legacyPayload.records) ? legacyPayload.records : [];
  const legacyById = new Map(legacyRecords.map((restaurant) => [restaurant.id, restaurant]));
  const lookups = buildCurrentLookups(restaurants);
  assert(lookups.collisions.length === 0, `Canonical id collisions: ${lookups.collisions.join(", ")}`);

  const migratedById = new Map();
  const recordMetaById = new Map();
  const conflicts = [];
  const unmatched = [];
  const migrations = [];

  for (const [oldId, rawRecord] of Object.entries(enrichmentPayload.records ?? {})) {
    const record = sanitizeRecord(rawRecord);
    const { targetId, origin } = resolveRecordId(oldId, lookups, legacyById);
    if (!targetId) {
      unmatched.push({ oldId, record });
      continue;
    }

    const incoming = { oldId, targetId, origin, record };
    const existing = recordMetaById.get(targetId);
    const choice = chooseRecord(existing, incoming);
    if (existing && !sameRecord(existing.record, record)) {
      conflicts.push({
        targetId,
        existingOldId: existing.oldId,
        incomingOldId: oldId,
        existingOrigin: existing.origin,
        incomingOrigin: origin,
        choice: choice.reason,
      });
    }
    if (!existing || choice.record === record) {
      migratedById.set(targetId, record);
      recordMetaById.set(targetId, incoming);
    }
    migrations.push({ oldId, targetId, origin, complete: isCompleteDianpingRecord(record) });
  }

  const migratedRecords = {};
  for (const restaurant of restaurants) {
    const nextId = lookups.oldIdToCanonical.get(restaurant.id);
    if (migratedById.has(nextId)) migratedRecords[nextId] = migratedById.get(nextId);
  }

  const migratedRestaurants = restaurants.map((restaurant) => ({
    ...restaurant,
    id: lookups.oldIdToCanonical.get(restaurant.id),
  }));

  writeRestaurantsTs(migratedRestaurants);
  writeJson(enrichmentPath, { records: migratedRecords });
  updateChinaSourceIds(lookups.oldIdToCanonical);

  const report = {
    migratedAt: new Date().toISOString(),
    canonicalScheme: "cn-{michelinProvinceSegment}-{michelinCitySegment}-{michelinRestaurantSlug}",
    restaurantRows: restaurants.length,
    idChanges: migrations.filter((migration) => migration.oldId !== migration.targetId).length,
    enrichmentBefore: Object.keys(enrichmentPayload.records ?? {}).length,
    enrichmentAfter: Object.keys(migratedRecords).length,
    completeBefore: Object.values(enrichmentPayload.records ?? {}).filter(isCompleteDianpingRecord).length,
    completeAfter: Object.values(migratedRecords).filter(isCompleteDianpingRecord).length,
    unmatched,
    conflicts,
    originCounts: migrations.reduce((acc, migration) => {
      acc[migration.origin] = (acc[migration.origin] ?? 0) + 1;
      return acc;
    }, {}),
    migrations,
  };
  writeJson(reportPath, report);

  console.log(
    `Canonical migration complete: ${restaurants.length} restaurants, ${report.enrichmentBefore}->${report.enrichmentAfter} enrichment records, complete ${report.completeBefore}->${report.completeAfter}, unmatched=${unmatched.length}, conflicts=${conflicts.length}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
