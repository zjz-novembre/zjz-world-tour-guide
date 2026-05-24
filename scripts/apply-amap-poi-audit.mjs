import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const auditPath = join(root, "output", "sources", "amap-poi-coordinate-audit.json");
const reportPath = join(root, "output", "sources", "amap-poi-coordinate-apply-report.json");
const michelinSourcePath = join(root, "src", "data", "restaurants.ts");
const blackPearlSourcePath = join(root, "output", "sources", "black-pearl-guide.json");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
    return [key, valueParts.length ? valueParts.join("=") : "true"];
  }),
);

const apply = args.get("apply") === "true";
const guides = new Set(String(args.get("guide") ?? "all").split(","));

const manualAmbiguousPoiOverrides = new Map([
  ["cn-shanghai-municipality-shanghai-il-ristorante-niko-romito-563683", "B0LG154AXH"],
  ["cn-shanghai-municipality-shanghai-summer-palace-506733", "B0I1LMHPJ9"],
  ["cn-shanghai-municipality-shanghai-sheng-yong-xing", "B0G2JCIRX4"],
  ["cn-shanghai-municipality-shanghai-fu-1015", "B00156KURL"],
  ["cn-shanghai-municipality-shanghai-fu-1039", "B00155MM22"],
  ["cn-shanghai-municipality-shanghai-mi-thai-an-fu-road", "B0IAD6T8B0"],
  ["cn-shanghai-municipality-shanghai-gastro-esthetics-at-dadong", "B00157FVJY"],
  ["cn-shanghai-municipality-shanghai-kanpai-classic-506687", "B0FFG7UM6X"],
  ["cn-beijing-municipality-beijing-les-morilles", "B0FFI5VT41"],
  ["cn-beijing-municipality-beijing-sheng-yong-xing-chaoyang", "B0FFHK25UV"],
  ["cn-beijing-municipality-beijing-fu-man-yuan-xinyuanli", "B0FFL2LYWO"],
  ["cn-jiang-su-nanjing-1029511-man-ho-1216552", "B0G0BKZ15B"],
  ["cn-jiang-su-nanjing-1029511-fong-sense", "B0J6RHOMZF"],
  ["cn-fujian-province-xiamen-1031934-kunsho", "B0IKZSRSNJ"],
  ["cn-guangdong-province-guangzhou-four-seasons-pavilion-duck-yuexiu", "B0FFL1DV20"],
  ["cn-guangdong-province-guangzhou-the-eminent", "B0JGTSLUFJ"],
  ["cn-chengdu-municipality-chengdu-gong-zhou-ba-shu-wei-yuan", "B0FFFAMVJP"],
  ["cn-chengdu-municipality-chengdu-mosnack", "B0FFHWEBHE"],
  ["cn-chengdu-municipality-chengdu-pairedd", "B0JG2Z42I2"],
  ["cn-chengdu-municipality-chengdu-member", "B0GRNLBM69"],
  ["cn-zhe-jiang-hangzhou-1027184-wang-ri-shun-hao", "B0KG7AVWKP"],
  ["cn-fujian-province-quanzhou-1030272-de-wen-xia-zai-mian", "B0IDFUVIUB"],
  ["bp-cn-shanghai-110306474", "B0LG154AXH"],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s'"`.,，。:：;；·•\-—–_()（）【】\[\]{}]/g, "")
    .replace(/上海市|北京市|天津市|重庆市|香港特别行政区|澳门特别行政区|中国|china|municipality|province|guangdong|beijing|shanghai|zhejiang|jiangsu|fujian|sichuan|macau|hongkong/gi, "");
}

function coreName(value) {
  return normalizeText(String(value ?? "").replace(/\s*[（(].*?[)）]\s*/g, ""));
}

function comparableAddress(record) {
  let value = normalizeText(record.currentAddress);
  for (const part of [record.cityName, record.district]) {
    const normalized = normalizeText(part);
    if (normalized) value = value.replaceAll(normalized, "");
  }
  return value;
}

function longestCommonSubstringLength(left, right) {
  if (!left || !right) return 0;
  const dp = new Array(right.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= left.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= right.length; j += 1) {
      const tmp = dp[j];
      dp[j] = left[i - 1] === right[j - 1] ? prev + 1 : 0;
      if (dp[j] > best) best = dp[j];
      prev = tmp;
    }
  }
  return best;
}

function hasAddressEvidence(record, selected) {
  const current = comparableAddress(record);
  const poi = normalizeText(selected.address);
  if (!current || !poi) return false;
  if (current.includes(poi) || poi.includes(current)) return true;
  const common = longestCommonSubstringLength(current, poi);
  return common >= 5;
}

function hasNameEvidence(record, selected) {
  const name = normalizeText(record.name);
  const core = coreName(record.name);
  const poi = normalizeText(selected.name);
  if (!name || !poi) return false;
  if (name === poi || core === poi) return true;
  if (name.length >= 3 && poi.includes(name)) return true;
  if (core.length >= 3 && poi.includes(core)) return true;
  if (poi.length >= 3 && name.includes(poi)) return true;
  if (poi.length >= 3 && core.includes(poi)) return true;
  if (core.length >= 2 && poi.includes(core) && selected.metrics?.district >= 1) return true;
  return false;
}

function isTooGeneric(record, selected) {
  const core = coreName(record.name);
  const poi = normalizeText(selected.name);
  if (core.length <= 1 && poi !== core) return true;
  if (core.length <= 2 && !hasAddressEvidence(record, selected) && (selected.metrics?.distance ?? 0) > 900) {
    return true;
  }
  return false;
}

function parentheticalParts(value) {
  return Array.from(String(value ?? "").matchAll(/[（(]([^()（）]+)[)）]/g))
    .map((match) => normalizeText(match[1]))
    .filter(Boolean);
}

function hasUnconfirmedBranch(record, selected) {
  const parts = parentheticalParts(record.name).filter((part) => {
    const city = normalizeText(record.cityName);
    const district = normalizeText(record.district);
    if (part.endsWith("区") || part.endsWith("市") || part.endsWith("县")) return false;
    if (city && (part === city || city.includes(part) || part.includes(city))) return false;
    if (district && (part === district || district.includes(part) || part.includes(district))) return false;
    return true;
  });
  if (!parts.length) return false;

  const selectedText = normalizeText(`${selected.name ?? ""}${selected.address ?? ""}`);
  return parts.some((part) => !selectedText.includes(part));
}

function isAlreadyExact(record) {
  const distance = record.selected?.metrics?.distance;
  return (
    Number.isFinite(distance) &&
    distance <= 30 &&
    record.currentAddress &&
    record.currentCoordinateSource === "amap" &&
    record.currentAmapPoiId === record.selected?.id
  );
}

function shouldApplyRecord(record) {
  const selected = record.selected;
  if (!selected?.id || !Array.isArray(selected.position) || !selected.address) {
    return { apply: false, reason: "missing-selected-poi-fields" };
  }
  if (record.manualAmbiguousPoiOverride === true) {
    return { apply: true, reason: "manual-ambiguous-confirmed" };
  }
  if (!["ok", "missing_address", "coordinate_review", "coordinate_mismatch"].includes(record.status)) {
    return { apply: false, reason: `status-${record.status}` };
  }
  if (selected.metrics?.food !== 1) return { apply: false, reason: "selected-poi-not-food" };
  if (record.currentCoordinateSource === "manual") return { apply: false, reason: "manual-coordinate-locked" };
  if (selected.metrics?.city < 1 && selected.metrics?.district < 1) {
    return { apply: false, reason: "city-or-district-not-confirmed" };
  }
  if (record.currentAmapPoiId && record.currentAmapPoiId !== selected.id && record.status === "ok") {
    return { apply: false, reason: "existing-amap-poi-differs" };
  }

  const addressEvidence = hasAddressEvidence(record, selected);
  const nameEvidence = hasNameEvidence(record, selected);
  const distance = selected.metrics?.distance ?? Number.POSITIVE_INFINITY;
  const score = selected.metrics?.score ?? 0;
  const nameScore = selected.metrics?.name ?? 0;

  if (!addressEvidence && !nameEvidence) return { apply: false, reason: "weak-name-and-address-evidence" };
  if (!addressEvidence && hasUnconfirmedBranch(record, selected)) {
    return { apply: false, reason: "missing-branch-evidence" };
  }
  if (isTooGeneric(record, selected)) return { apply: false, reason: "generic-short-name-without-address-evidence" };

  if (isAlreadyExact(record)) return { apply: false, reason: "already-exact" };
  if (addressEvidence && nameScore >= 0.62) return { apply: true, reason: "address-confirmed" };
  if (record.currentAmapPoiId && record.currentAmapPoiId === selected.id) return { apply: true, reason: "same-amap-poi-id" };
  if (nameScore >= 0.82 && distance <= 900) return { apply: true, reason: "systematic-coordinate-offset" };
  if (nameScore >= 0.92 && score >= 0.63 && selected.metrics?.district >= 1 && distance <= 2200) {
    return { apply: true, reason: "strong-name-district-match" };
  }
  if (!record.currentAddress && nameScore >= 0.92 && selected.metrics?.district >= 1 && score >= 0.63) {
    return { apply: true, reason: "missing-address-strong-name-district-match" };
  }

  return { apply: false, reason: "below-confidence-threshold" };
}

function readMichelinRestaurants() {
  const source = readFileSync(michelinSourcePath, "utf8");
  const jsonStart = source.indexOf("= [") + 2;
  const jsonEnd = source.lastIndexOf("];");
  assert(jsonStart > 1 && jsonEnd > jsonStart, "Could not locate restaurants array in Michelin source");
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

function writeMichelinRestaurants(records) {
  writeFileSync(
    michelinSourcePath,
    `import type { Restaurant } from "../types";

export const restaurants: Restaurant[] = ${JSON.stringify(records, null, 2)};
`,
  );
}

function readBlackPearlPayload() {
  const payload = JSON.parse(readFileSync(blackPearlSourcePath, "utf8"));
  assert(Array.isArray(payload.records), "Black Pearl source is missing records[]");
  return payload;
}

function amapSearch(name, cityName) {
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(`${name} ${cityName}`)}`;
}

function patchRestaurant(restaurant, record) {
  const selected = record.selected;
  return {
    ...restaurant,
    district: selected.district || restaurant.district,
    address: selected.address,
    position: selected.position,
    coorSys: "GCJ-02",
    coordinateSystem: "GCJ-02",
    coordinateSource: "amap",
    amapPoiId: selected.id,
    poiQuery: `${selected.name} ${record.cityName}`,
    mapsUrl: restaurant.sourceUrl?.includes("blackpearl.meituan.com")
      ? restaurant.mapsUrl
      : amapSearch(selected.name, record.cityName),
  };
}

function summarize(items) {
  return items.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});
}

function main() {
  const audit = JSON.parse(readFileSync(auditPath, "utf8"));
  assert(audit.complete === true, "AMap audit is incomplete; run audit-amap-poi-coordinates first");
  assert(Array.isArray(audit.records), "AMap audit is missing records[]");

  const decisions = audit.records
    .filter((record) => guides.has("all") || guides.has(record.guide))
    .map((record) => {
      const manualPoiId = manualAmbiguousPoiOverrides.get(record.id);
      const selected = manualPoiId
        ? (record.candidates ?? []).find((candidate) => candidate.id === manualPoiId)
        : record.selected;
      const nextRecord = manualPoiId
        ? { ...record, selected, manualAmbiguousPoiOverride: Boolean(selected) }
        : record;
      return { ...nextRecord, decision: shouldApplyRecord(nextRecord) };
    });

  const applied = decisions.filter((record) => record.decision.apply);
  const skipped = decisions.filter((record) => !record.decision.apply);

  const byGuide = {
    michelin: new Map(applied.filter((record) => record.guide === "michelin").map((record) => [record.id, record])),
    "black-pearl": new Map(applied.filter((record) => record.guide === "black-pearl").map((record) => [record.id, record])),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    sourceAudit: auditPath,
    mode: apply ? "apply" : "dry-run",
    appliedCount: applied.length,
    skippedCount: skipped.length,
    appliedByGuide: applied.reduce((acc, record) => {
      acc[record.guide] = (acc[record.guide] ?? 0) + 1;
      return acc;
    }, {}),
    appliedByReason: summarize(applied.map((record) => ({ reason: record.decision.reason }))),
    skippedByReason: summarize(skipped.map((record) => ({ reason: record.decision.reason }))),
    applied: applied.map((record) => ({
      guide: record.guide,
      id: record.id,
      name: record.name,
      cityName: record.cityName,
      status: record.status,
      reason: record.decision.reason,
      previousAddress: record.currentAddress,
      previousPosition: record.currentPosition,
      amapPoiId: record.selected.id,
      amapName: record.selected.name,
      amapAddress: record.selected.address,
      amapPosition: record.selected.position,
      distanceMeters: record.selected.metrics?.distance ?? null,
      score: record.selected.metrics?.score ?? null,
      nameScore: record.selected.metrics?.name ?? null,
    })),
    skippedReview: skipped
      .filter((record) => ["coordinate_mismatch", "coordinate_review", "missing_address"].includes(record.status))
      .map((record) => ({
        guide: record.guide,
        id: record.id,
        name: record.name,
        cityName: record.cityName,
        status: record.status,
        reason: record.decision.reason,
        selectedName: record.selected?.name ?? null,
        selectedAddress: record.selected?.address ?? null,
        selectedPosition: record.selected?.position ?? null,
        distanceMeters: record.selected?.metrics?.distance ?? null,
        score: record.selected?.metrics?.score ?? null,
        nameScore: record.selected?.metrics?.name ?? null,
      })),
  };

  mkdirSync(join(root, "output", "sources"), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (apply) {
    const michelinRestaurants = readMichelinRestaurants().map((restaurant) => {
      const record = byGuide.michelin.get(restaurant.id);
      return record ? patchRestaurant(restaurant, record) : restaurant;
    });
    writeMichelinRestaurants(michelinRestaurants);

    const blackPearlPayload = readBlackPearlPayload();
    blackPearlPayload.records = blackPearlPayload.records.map((restaurant) => {
      const record = byGuide["black-pearl"].get(restaurant.id);
      return record ? patchRestaurant(restaurant, record) : restaurant;
    });
    blackPearlPayload.updatedAt = new Date().toISOString();
    blackPearlPayload.enrichmentNotes = [
      ...(Array.isArray(blackPearlPayload.enrichmentNotes) ? blackPearlPayload.enrichmentNotes : []),
      `Applied ${byGuide["black-pearl"].size} AMap POI address/coordinate corrections from ${auditPath}.`,
    ];
    writeFileSync(blackPearlSourcePath, `${JSON.stringify(blackPearlPayload, null, 2)}\n`);
  }

  console.log(`[write] ${reportPath}`);
  console.log(
    `[summary] mode=${report.mode} applied=${report.appliedCount} skipped=${report.skippedCount} byGuide=${JSON.stringify(report.appliedByGuide)}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  exit(1);
}
