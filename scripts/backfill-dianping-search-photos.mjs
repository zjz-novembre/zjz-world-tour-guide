import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const candidatePath = join(root, "output", "sources", "michelin-dianping-search-photo-candidates.json");
const enrichmentPath = join(root, "output", "sources", "dianping-enrichment.json");
const evidencePath = join(root, "output", "sources", "michelin-dianping-search-photo-backfill-20260518.json");

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.slice(2).split("=");
  const value = inlineValue ?? process.argv[index + 1];
  args.set(key, value);
  if (inlineValue === undefined) index += 1;
}

const write = args.get("write") === "1" || args.get("write") === "true";
const force = args.get("force") === "1" || args.get("force") === "true";
const onlyId = args.get("id") ?? "";

const headers = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(join(root, "output", "sources"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function shopIdFromUrl(url) {
  return String(url ?? "").match(/\/(?:shop|shopinfo|shopshare)\/([^/?#]+)/)?.[1] ?? "";
}

function canonicalUrl(url) {
  const shopId = shopIdFromUrl(url);
  return shopId ? `https://www.dianping.com/shop/${shopId}` : "";
}

function buildNumericAppUrl(shopId, appShopId) {
  const originalUrl = `https://m.dianping.com/shop/${encodeURIComponent(shopId)}`;
  const schema = `dianping://shopinfo?id=${encodeURIComponent(String(appShopId))}&utm=w_mshop_auto`;
  return `https://link.dianping.com/universal-link?originalUrl=${encodeURIComponent(originalUrl)}&schema=${encodeURIComponent(schema)}`;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function uniqueStrings(values, limit = 5) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = decodeHtml(value)
      .replace(/\(\d+\)$/u, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!cleaned || seen.has(cleaned)) continue;
    if (cleaned.length > 36) continue;
    if (/^(菜|菜单|账单|价目表|环境|大堂|门面|包房|餐具摆设|景观位|其他|商户官方图片)$/u.test(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function parsePrice(html) {
  const patterns = [
    /¥\s*(\d{2,5})\s*\/人/u,
    /￥\s*(\d{2,5})\s*\/人/u,
    /人均\s*[¥￥:]?\s*(\d{2,5})/u,
    /"avgPrice"\s*:\s*"?(\d{2,5})"?/u,
    /"priceText"\s*:\s*"[^"]*?(\d{2,5})/u,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return Number(value);
  }
  return null;
}

function parseAppShopId(html, shopId) {
  if (/^\d+$/u.test(shopId)) return shopId;
  const patterns = [
    /data-launch-shop-id="(\d+)"/u,
    /shopinfo\?shopId=(\d+)/iu,
    /shopid=(\d+)/iu,
    /"shopId"\s*:\s*"?(\d+)"?/iu,
    /"id"\s*:\s*(\d+)[\s\S]{0,3000}"shopUuid"/iu,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value && /^\d+$/u.test(value)) return value;
  }
  return "";
}

function parsePhotoDishes(html) {
  const dishAnchor = html.search(/photos\/tag-%E8%8F%9C["-]/iu);
  if (dishAnchor < 0) return [];
  const section = html.slice(dishAnchor, dishAnchor + 9000);
  const raw = [];
  for (const match of section.matchAll(/title="([^"]+?\(\d+\))"[^>]*>(?:[^<]*?)(?:\(\d+\))?<\/a>/giu)) {
    raw.push(match[1]);
  }
  if (raw.length < 5) {
    for (const match of section.matchAll(/tag-%E8%8F%9C-[^"]+"[^>]*>([^<]+?)\(\d+\)<\/a>/giu)) {
      raw.push(match[1]);
    }
  }
  return uniqueStrings(raw, 5);
}

async function fetchText(url) {
  const response = await fetch(url, { headers, redirect: "follow" });
  const text = await response.text();
  return { status: response.status, url: response.url, text };
}

function complete(record) {
  if (!record) return false;
  const requiredDishes = record.acceptShortRecommendedDishes ? 1 : 5;
  return Boolean(
    record.url &&
      Number.isFinite(record.avgPriceCny) &&
      Array.isArray(record.recommendedDishes) &&
      record.recommendedDishes.length >= requiredDishes,
  );
}

async function main() {
  const candidates = readJson(candidatePath, { records: {} }).records ?? {};
  const enrichment = readJson(enrichmentPath, { records: {} });
  const evidence = [];

  for (const [id, candidate] of Object.entries(candidates)) {
    if (onlyId && id !== onlyId) continue;
    const existing = enrichment.records?.[id];
    if (!force && complete(existing)) {
      evidence.push({ id, status: "existing_complete" });
      continue;
    }

    const shopId = shopIdFromUrl(candidate.url);
    if (!shopId) {
      evidence.push({ id, status: "missing_shop_id", candidate });
      continue;
    }

    const m = await fetchText(`https://m.dianping.com/shopinfo/${encodeURIComponent(shopId)}`);
    const photos = await fetchText(`https://www.dianping.com/shop/${encodeURIComponent(shopId)}/photos`);
    const avgPriceCny = parsePrice(m.text) ?? parsePrice(photos.text) ?? candidate.avgPriceCny ?? null;
    const dianpingAppShopId = parseAppShopId(m.text, shopId);
    const recommendedDishes = parsePhotoDishes(photos.text);
    const record = {
      url: canonicalUrl(candidate.url),
      ...(Number.isFinite(avgPriceCny) ? { avgPriceCny: Math.round(avgPriceCny) } : {}),
      ...(recommendedDishes.length ? { recommendedDishes } : {}),
      dianpingShopUuid: shopId,
      ...(dianpingAppShopId ? { dianpingAppShopId } : {}),
      ...(dianpingAppShopId ? { dianpingAppUrl: buildNumericAppUrl(shopId, dianpingAppShopId) } : {}),
      ...(candidate.acceptShortRecommendedDishes ? { acceptShortRecommendedDishes: true } : {}),
    };
    const status = complete(record) ? "complete" : "incomplete";

    if (write && status === "complete") {
      enrichment.records[id] = record;
      writeJson(enrichmentPath, { records: enrichment.records });
    }

    evidence.push({
      id,
      status,
      source: candidate.source ?? "search",
      candidateUrl: candidate.url,
      mStatus: m.status,
      mUrl: m.url,
      photosStatus: photos.status,
      photosUrl: photos.url,
      avgPriceCny: record.avgPriceCny ?? null,
      recommendedDishes,
      dianpingAppShopId: record.dianpingAppShopId ?? "",
      written: write && status === "complete",
      notes: candidate.notes ?? "",
    });
  }

  writeJson(evidencePath, { generatedAt: new Date().toISOString(), write, force, evidence });
  if (write) writeJson(enrichmentPath, { records: enrichment.records ?? {} });
  console.log(`checked ${evidence.length}, complete ${evidence.filter((row) => row.status === "complete").length}, written ${evidence.filter((row) => row.written).length}`);
  console.log(evidencePath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
