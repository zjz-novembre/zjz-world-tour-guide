import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cwd, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const sourcePath = join(root, "src", "data", "restaurants.ts");
const outputPath = join(root, "output", "sources", "dianping-enrichment.json");

const cityIds = {
  beijing: 2,
  guangzhou: 4,
  hangzhou: 3,
  nanjing: 5,
  suzhou: 6,
  yangzhou: 12,
  changzhou: 93,
  taizhou: 108,
  wenzhou: 101,
  fuzhou: 14,
  quanzhou: 129,
  ningde: 133,
  xiamen: 15,
  shanghai: 1,
  chengdu: 8,
  "hong-kong": 344,
  macau: 342,
};

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.slice(2).split("=");
  const value = inlineValue ?? process.argv[index + 1];
  args.set(key, value);
  if (inlineValue === undefined) index += 1;
}

const limit = Number(args.get("limit") ?? "490");
const successLimit = Number(args.get("success-limit") ?? "0");
const requireComplete = args.get("require-complete") === "1" || args.get("require-complete") === "true";
const cityFilter = args.get("city");
const idFilter = args.get("id");
const skipIds = new Set(
  String(args.get("skip-id") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const force = args.get("force") === "1" || args.get("force") === "true";
const missingOnly = args.get("missing-only") === "1" || args.get("missing-only") === "true";
const pagePollMs = readNumberArg("page-poll-ms", 500, 200, 10_000);
const queryDelayMs = readNumberArg("query-delay-ms", 8_000, 0, 60_000);
const restaurantDelayMs = readNumberArg("restaurant-delay-ms", 30_000, 0, 180_000);
const jitterMs = readNumberArg("jitter-ms", 8_000, 0, 120_000);
const verificationWaitMs = readNumberArg("verification-wait-ms", 30_000, 0, 600_000);
const verificationMaxWaits = readNumberArg("verification-max-waits", 60, 0, 100);
const verificationPath = args.get("verification") ?? (
  cityFilter ? join(root, "output", "sources", `dianping-${cityFilter}-verification.html`) : ""
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readNumberArg(name, fallback, min, max) {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

async function pacingDelay(baseMs, label) {
  const waitMs = baseMs + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
  if (waitMs <= 0) return;
  if (waitMs >= 1000) console.log(`${label}: ${Math.round(waitMs / 1000)}s`);
  await delay(waitMs);
}

function readRestaurants() {
  const source = readFileSync(sourcePath, "utf8");
  const jsonStart = source.indexOf("= [") + 2;
  const jsonEnd = source.lastIndexOf("];");
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

function readOutput() {
  if (!existsSync(outputPath)) return { records: {} };
  const payload = JSON.parse(readFileSync(outputPath, "utf8"));
  return { records: payload.records ?? {} };
}

function writeOutput(payload) {
  mkdirSync(join(root, "output", "sources"), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ records: payload.records ?? {} }, null, 2)}\n`);
}

function runOsascript(script, argv = []) {
  const result = spawnSync("osascript", ["-", ...argv], {
    input: script,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60 * 1000,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "osascript failed");
  }
  return result.stdout.trim();
}

function setActiveTabUrl(url) {
  runOsascript(
    `on run argv
      with timeout of 600 seconds
        tell application "Google Chrome"
          if (count of windows) is 0 then make new window
          set targetWindow to front window
          if (count of tabs of targetWindow) is 0 then make new tab at end of tabs of targetWindow
          set URL of active tab of targetWindow to item 1 of argv
        end tell
      end timeout
    end run`,
    [url],
  );
}

function runChromeJs(source) {
  return runOsascript(
    `on run argv
      with timeout of 600 seconds
        tell application "Google Chrome"
          if (count of windows) is 0 then make new window
          set targetWindow to front window
          if (count of tabs of targetWindow) is 0 then make new tab at end of tabs of targetWindow
          return execute active tab of targetWindow javascript (item 1 of argv)
        end tell
      end timeout
    end run`,
    [source],
  );
}

async function waitForReady(expectedUrlPart, expectedUrl = null) {
  for (let attempt = 0; attempt < 140; attempt += 1) {
    const state = JSON.parse(
      runChromeJs(`JSON.stringify({
        ready: document.readyState,
        url: location.href,
        title: document.title,
        text: document.body ? document.body.innerText.slice(0, 3000) : "",
        shopLinkCount: document.querySelectorAll('a[href*="/shop/"]').length,
        blocked: location.hostname.includes("account.dianping.com") || location.hostname.includes("verify.meituan.com")
      })`),
    );
    if (state.blocked) return state;
    if (!state.url.includes(expectedUrlPart) || (expectedUrl && !matchesExpectedUrl(state.url, expectedUrl))) {
      if (expectedUrl && attempt > 0 && attempt % 20 === 0) setActiveTabUrl(expectedUrl);
      await delay(pagePollMs);
      continue;
    }

    const hasUsableBody = typeof state.text === "string" && state.text.trim().length > 40;
    const hasSearchResults =
      expectedUrlPart.includes("/search/keyword/") &&
      (state.blocked ||
        (state.shopLinkCount > 0 && /条评价|人均/.test(state.text)) ||
        /没有找到|商户没有被收录/.test(state.text));
    const hasShopDetail =
      expectedUrlPart.includes("/shop/") &&
      (state.blocked || /网友推荐|人均|评价/.test(state.text) || state.text.trim().length > 500);
    if (state.ready === "complete" || hasSearchResults || hasShopDetail || hasUsableBody && !expectedUrlPart.includes("/search/keyword/")) {
      return state;
    }
    await delay(pagePollMs);
  }
  throw new Error(`Chrome tab did not become ready for ${expectedUrlPart}`);
}

function matchesExpectedUrl(actual, expected) {
  if (actual === expected) return true;
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    return actualUrl.origin === expectedUrl.origin && actualUrl.pathname === expectedUrl.pathname;
  } catch {
    return false;
  }
}

function branchTokens(name) {
  return [...String(name || "").matchAll(/[（(]([^）)]+)[）)]/g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function baseName(name) {
  return String(name || "").replace(/[（(].*?[）)]/g, "").replace(/\s+/g, " ").trim();
}

function chineseNumeralNameVariants(value) {
  const base = String(value || "");
  const digitMap = {
    零: "0",
    〇: "0",
    一: "1",
    壹: "1",
    二: "2",
    两: "2",
    貳: "2",
    贰: "2",
    三: "3",
    叁: "3",
    四: "4",
    肆: "4",
    五: "5",
    伍: "5",
    六: "6",
    陆: "6",
    陸: "6",
    七: "7",
    柒: "7",
    八: "8",
    捌: "8",
    九: "9",
    玖: "9",
  };
  const formalMap = {
    零: "零",
    〇: "零",
    一: "壹",
    二: "贰",
    两: "贰",
    三: "叁",
    四: "肆",
    五: "伍",
    六: "陆",
    七: "柒",
    八: "捌",
    九: "玖",
  };
  const digit = base.replace(/[零〇一壹二两貳贰三叁四肆五伍六陆陸七柒八捌九玖]/g, (char) => digitMap[char] ?? char);
  const formal = base.replace(/[零〇一二两三四五六七八九]/g, (char) => formalMap[char] ?? char);
  const variants = [digit, formal].filter((variant) => variant && variant !== base);
  const numericOnly = digit.match(/\d{2,}/)?.[0];
  if (numericOnly) variants.push(numericOnly);
  return [...new Set(variants)];
}

function restaurantNameAliases(name) {
  const base = baseName(name);
  const aliases = [];
  if (base.includes("莱莱小笼")) aliases.push("莱莱小笼");
  if (base.includes("海门鱼仔店")) aliases.push("海门鱼仔");
  aliases.push(...chineseNumeralNameVariants(base));
  return [...new Set(aliases)].filter((alias) => alias && alias !== base);
}

function uniqueQueries(queries) {
  const seen = new Set();
  return queries
    .flatMap((entry) =>
      queryTextVariants(entry.query).map((query) => ({
        query,
        requireBranch: entry.requireBranch,
      })),
    )
    .filter((entry) => {
      if (!entry.query || seen.has(entry.query)) return false;
      seen.add(entry.query);
      return true;
    });
}

function queryTextVariants(value) {
  const original = String(value || "").replace(/\s+/g, " ").trim();
  const simplified = simplifyChineseForQuery(original);
  const macauSimplified = simplified.replaceAll("澳門", "澳门");
  const macauTraditional = original.replaceAll("澳门", "澳門");
  return [...new Set([original, simplified, macauSimplified, macauTraditional].filter(Boolean))];
}

function simplifyChineseForQuery(value) {
  const map = {
    蘭: "兰",
    寶: "宝",
    寳: "宝",
    閣: "阁",
    館: "馆",
    舘: "馆",
    園: "园",
    廳: "厅",
    樓: "楼",
    麵: "面",
    鮮: "鲜",
    魚: "鱼",
    雞: "鸡",
    鷄: "鸡",
    龍: "龙",
    門: "门",
    乾: "干",
    雲: "云",
    華: "华",
    廣: "广",
    順: "顺",
    興: "兴",
    齋: "斋",
    葉: "叶",
    潤: "润",
    開: "开",
    飯: "饭",
    蝦: "虾",
    禮: "礼",
    東: "东",
    風: "风",
    味: "味",
    鸞: "鸾",
    鳴: "鸣",
    鯤: "鲲",
    軒: "轩",
    巢: "巢",
    國: "国",
    餐: "餐",
    榮: "荣",
    荳: "豆",
    鮮: "鲜",
    軟: "软",
    滑: "滑",
    腸: "肠",
    記: "记",
    粥: "粥",
    麵: "面",
    廚: "厨",
    譽: "誉",
    瓏: "珑",
    麗: "丽",
    鐵: "铁",
    燒: "烧",
    鵝: "鹅",
    黃: "黄",
    灣: "湾",
    廣: "广",
    聖: "圣",
    馬: "马",
    體: "体",
    連: "连",
    貫: "贯",
    倫: "伦",
    賞: "赏",
    湯: "汤",
    無: "无",
    勝: "胜",
    當: "当",
    豐: "丰",
    餅: "饼",
    舊: "旧",
  };
  return String(value || "").replace(/[\u3400-\u9fff]/g, (char) => map[char] ?? char);
}

function searchQueries(restaurant) {
  const branches = branchTokens(restaurant.name);
  const base = baseName(restaurant.name);
  const city = restaurant.cityName;
  const address = addressSearchTerm(restaurant.address);
  const nameWithBranchWords = String(restaurant.name || "")
    .replace(/\s*[（(]\s*/g, " ")
    .replace(/\s*[）)]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return uniqueQueries([
    { query: restaurant.poiQuery, requireBranch: branches.length > 0 },
    ...restaurantNameAliases(restaurant.name).flatMap((alias) => [
      { query: `${alias} ${city}`, requireBranch: false },
      ...(address ? [{ query: `${alias} ${address}`, requireBranch: false }] : []),
    ]),
    ...(address
      ? [
          { query: `${restaurant.name} ${address}`, requireBranch: branches.length > 0 },
          { query: `${base} ${address}`, requireBranch: branches.length > 0 },
        ]
      : []),
    { query: `${nameWithBranchWords} ${city}`, requireBranch: branches.length > 0 },
    ...branches.map((branch) => ({ query: `${base} ${branch} ${city}`, requireBranch: true })),
    ...branches.map((branch) => ({ query: `${base}${branch} ${city}`, requireBranch: true })),
    { query: `${base} ${city}`, requireBranch: false },
  ]);
}

function addressSearchTerm(address) {
  const chinesePart = String(address ?? "")
    .split(",")[0]
    .replace(/\s+/g, "")
    .trim();
  return /[\u3400-\u9fff]/.test(chinesePart) ? chinesePart : "";
}

function addressEvidenceTerms(address) {
  const chinesePart = addressSearchTerm(address);
  const terms = new Set();
  for (const chunk of chinesePart.split(/[0-9０-９一二三四五六七八九十号楼层室]/)) {
    const cleaned = chunk.replace(/^[\u3400-\u9fff]{1,8}区/, "").replace(/^号/, "").trim();
    if (cleaned.length >= 3) terms.add(cleaned);
  }
  for (const match of chinesePart.matchAll(/[\u3400-\u9fff]{2,}(?:路|街|巷|道|大道|酒店|商场|广场|大厦|中心|花园|公馆)/g)) {
    const value = match[0].replace(/^[\u3400-\u9fff]{1,8}区/, "");
    if (value.length >= 3) terms.add(value);
  }
  return [...terms].slice(0, 8);
}

function searchUrlForQuery(restaurant, query) {
  const cityId = cityIds[restaurant.city];
  if (!cityId) throw new Error(`Missing Dianping city id for ${restaurant.city}`);
  return `https://www.dianping.com/search/keyword/${cityId}/0_${encodeURIComponent(query)}`;
}

function shopUuidFromUrl(url) {
  return String(url ?? "").match(/\/shop\/([^/?#]+)/)?.[1] ?? "";
}

function buildNumericAppUrl(shopUuid, appShopId) {
  const originalUrl = `https://m.dianping.com/shop/${encodeURIComponent(shopUuid)}`;
  const schema = `dianping://shopinfo?id=${encodeURIComponent(String(appShopId))}&utm=w_mshop_auto`;
  return `https://link.dianping.com/universal-link?originalUrl=${encodeURIComponent(originalUrl)}&schema=${encodeURIComponent(schema)}`;
}

function buildFallbackAppUrl(shopUuid) {
  return `https://m.dianping.com/shopshare/${encodeURIComponent(shopUuid)}`;
}

function uniqueStrings(items, maxItems) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const value = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!value || seen.has(value) || value.length > 24) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= maxItems) break;
  }
  return result;
}

function sanitizeRecord(record) {
  const recommendedDishes = uniqueStrings(record.recommendedDishes ?? [], 5);
  return {
    ...(Number.isFinite(record.avgPriceCny) ? { avgPriceCny: Math.round(record.avgPriceCny) } : {}),
    ...(recommendedDishes.length ? { recommendedDishes } : {}),
    ...(record.url ? { url: record.url } : {}),
    ...(record.dianpingAppShopId ? { dianpingAppShopId: record.dianpingAppShopId } : {}),
    ...(record.dianpingAppUrl ? { dianpingAppUrl: record.dianpingAppUrl } : {}),
    ...(record.dianpingShopUuid ? { dianpingShopUuid: record.dianpingShopUuid } : {}),
  };
}

function hasValues(record) {
  return Boolean(
    record.url ||
      Number.isFinite(record.avgPriceCny) ||
      record.recommendedDishes?.length ||
      record.dianpingAppShopId,
  );
}

function hasCompleteValues(record) {
  return Boolean(
    record?.url &&
      Number.isFinite(record.avgPriceCny) &&
      record.recommendedDishes?.length >= 5 &&
      typeof record.dianpingAppShopId === "string" &&
      /^\d+$/.test(record.dianpingAppShopId),
  );
}

function isSuccessfulRecord(record) {
  return requireComplete ? hasCompleteValues(record) : hasValues(record);
}

function writeVerification(records, path = verificationPath) {
  if (!path) return;
  mkdirSync(join(root, "output", "sources"), { recursive: true });
  const rows = records.map(({ restaurant, record, status }, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(restaurant.name)}</td>
      <td>${escapeHtml(restaurant.address ?? "")}</td>
      <td>${record?.avgPriceCny ?? ""}</td>
      <td>${escapeHtml((record?.recommendedDishes ?? []).join(" / "))}</td>
      <td>${record?.url ? `<a href="${escapeHtml(record.url)}">${escapeHtml(record.url)}</a>` : ""}</td>
      <td>${escapeHtml(status)}</td>
    </tr>`).join("");
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dianping Verification ${escapeHtml(cityFilter ?? "")}</title>
  <style>
    body { margin: 24px; color: #171717; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: #fff; }
    a { color: #9f231f; }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>餐厅</th>
        <th>地址</th>
        <th>人均</th>
        <th>推荐菜</th>
        <th>大众点评</th>
        <th>状态</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
  writeFileSync(path, `${html}\n`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseSearchPage(restaurant, requireBranch) {
  const addressTerms = addressEvidenceTerms(restaurant.address);
  return JSON.parse(
    runChromeJs(`(() => {
      const requireBranch = ${requireBranch ? "true" : "false"};
      const addressTerms = ${JSON.stringify(addressTerms)};
      const compact = (value) => String(value || "")
        .toLowerCase()
        .replace(/[蘭]/g, "兰")
        .replace(/[寶寳]/g, "宝")
        .replace(/[閣]/g, "阁")
        .replace(/[館舘]/g, "馆")
        .replace(/[園]/g, "园")
        .replace(/[廳]/g, "厅")
        .replace(/[樓]/g, "楼")
        .replace(/[麵]/g, "面")
        .replace(/[鮮]/g, "鲜")
        .replace(/[魚]/g, "鱼")
        .replace(/[雞鷄]/g, "鸡")
        .replace(/[龍]/g, "龙")
        .replace(/[門]/g, "门")
        .replace(/[乾]/g, "干")
        .replace(/[雲]/g, "云")
        .replace(/[零〇]/g, "0")
        .replace(/[一壹]/g, "1")
        .replace(/[二两貳贰]/g, "2")
        .replace(/[三叁]/g, "3")
        .replace(/[四肆]/g, "4")
        .replace(/[五伍]/g, "5")
        .replace(/[六陆陸]/g, "6")
        .replace(/[七柒]/g, "7")
        .replace(/[八捌]/g, "8")
        .replace(/[九玖]/g, "9")
        .replace(/[華]/g, "华")
        .replace(/[廣]/g, "广")
        .replace(/[順]/g, "顺")
        .replace(/[興]/g, "兴")
        .replace(/[齋]/g, "斋")
        .replace(/[葉]/g, "叶")
        .replace(/[潤]/g, "润")
        .replace(/[開]/g, "开")
        .replace(/[飯]/g, "饭")
        .replace(/[蝦]/g, "虾")
        .replace(/[禮]/g, "礼")
        .replace(/[東]/g, "东")
        .replace(/[風]/g, "风")
        .replace(/[鸞]/g, "鸾")
        .replace(/[鳴]/g, "鸣")
        .replace(/[鯤]/g, "鲲")
        .replace(/[軒]/g, "轩")
        .replace(/[國]/g, "国")
        .replace(/[榮]/g, "荣")
        .replace(/[荳]/g, "豆")
        .replace(/[軟]/g, "软")
        .replace(/[腸]/g, "肠")
        .replace(/[記]/g, "记")
        .replace(/[廚]/g, "厨")
        .replace(/[譽]/g, "誉")
        .replace(/[瓏]/g, "珑")
        .replace(/[麗]/g, "丽")
        .replace(/[鐵]/g, "铁")
        .replace(/[燒]/g, "烧")
        .replace(/[鵝]/g, "鹅")
        .replace(/[黃]/g, "黄")
        .replace(/[灣]/g, "湾")
        .replace(/[聖]/g, "圣")
        .replace(/[馬]/g, "马")
        .replace(/[體]/g, "体")
        .replace(/[連]/g, "连")
        .replace(/[貫]/g, "贯")
        .replace(/[倫]/g, "伦")
        .replace(/[賞]/g, "赏")
        .replace(/[湯]/g, "汤")
        .replace(/[無]/g, "无")
        .replace(/[勝]/g, "胜")
        .replace(/[當]/g, "当")
        .replace(/[豐]/g, "丰")
        .replace(/[餅]/g, "饼")
        .replace(/[（]/g, "(")
        .replace(/[）]/g, ")")
        .replace(/[()·'"’‘\`.,，。_\\-\\s]/g, "");
      const baseName = (value) => String(value || "").replace(/[（(].*?[）)]/g, "");
      const branchTokens = (value) => [...String(value || "").matchAll(/[（(]([^）)]+)[）)]/g)]
        .map((match) => compact(match[1]).replace(/店$/, ""))
        .filter(Boolean);
      const isShortLatinName = (value) => /^[a-z0-9]+$/.test(value) && value.length <= 4;
      const score = (expected, candidate, cardText) => {
        const left = compact(expected);
        const right = compact(candidate);
        const wholeCard = compact(cardText);
        const branches = branchTokens(expected);
        if (!left || !right) return 0;
        if (left === right) return 1;
        if (isShortLatinName(left)) {
          const rawCandidate = String(candidate || "").toLowerCase().trim();
          const rawCard = String(cardText || "").toLowerCase();
          const startsAsChineseQualifiedName = new RegExp(\`^\${left}[\\u3400-\\u9fff]\`, "i").test(rawCandidate);
          const hasAddressEvidence = addressTerms.map(compact).some((term) => term.length >= 3 && wholeCard.includes(term));
          if (startsAsChineseQualifiedName || hasAddressEvidence) return 0.92;
          return 0;
        }
        if (right.includes(left) || wholeCard.includes(left)) return 0.98;

        if (branches.length) {
          const hasBranch = branches.every((token) => {
            const normalizedToken = token.replace(/路$/, "店");
            return right.includes(token) ||
              wholeCard.includes(token) ||
              right.includes(normalizedToken) ||
              wholeCard.includes(normalizedToken);
          });
          const expectedBase = compact(baseName(expected));
          const candidateBase = compact(baseName(candidate));
          const hasExpectedBase =
            candidateBase.includes(expectedBase) ||
            wholeCard.includes(expectedBase) ||
            (expectedBase.includes("乔艾莱莱小笼") && candidateBase.includes("莱莱小笼") && candidateBase.includes("乔艾")) ||
            (candidateBase.length >= 4 && expectedBase.endsWith(candidateBase));
          const hasAddressEvidence = addressTerms.map(compact).some((term) => term.length >= 3 && wholeCard.includes(term));
          const hasPrice = price(cardText) !== null;
          if (!hasBranch && requireBranch) {
            if (hasExpectedBase && hasAddressEvidence) return 0.93;
            if (hasExpectedBase && hasPrice) return 0.88;
            return 0;
          }
          if (!hasBranch) {
            if (hasExpectedBase) return 0.86;
            return 0;
          }
          if (hasExpectedBase) return 0.92;
          return 0;
        }

        const expectedBase = compact(baseName(expected));
        const candidateBase = compact(baseName(candidate));
        if (candidateBase.includes(expectedBase) || expectedBase.includes(candidateBase)) return 0.86;
        return 0;
      };
      const price = (text) => {
        const match = String(text || "").match(/人均\\s*[¥￥:]?\\s*(\\d{2,5})/);
        return match ? Number(match[1]) : null;
      };
      const anchors = [...document.querySelectorAll('a[href*="/shop/"]')];
      const byShop = new Map();
      for (const anchor of anchors) {
        const container = anchor.closest("li") || anchor.closest(".shop-list") || anchor.closest(".txt") || anchor.parentElement;
        const text = (container?.innerText || anchor.innerText || "").replace(/\\s+/g, " ").trim();
        const href = new URL(anchor.getAttribute("href"), location.origin).href;
        const shopPath = href.match(/\\/shop\\/[^/?#]+/)?.[0] || href;
        const name = (anchor.textContent || "").replace(/\\s+/g, " ").trim();
        const existing = byShop.get(shopPath) || {
          name: "",
          href,
          text: "",
          avgPriceCny: null
        };
        existing.name = existing.name || name || text.split(" ").find(Boolean) || "";
        existing.text = [existing.text, text].filter(Boolean).join(" ");
        existing.avgPriceCny = existing.avgPriceCny ?? price(text);
        byShop.set(shopPath, existing);
      }
      const cards = [...byShop.values()].slice(0, 20).map((card) => ({
        ...card,
        avgPriceCny: card.avgPriceCny ?? price(card.text),
        matchScore: score(${JSON.stringify(restaurant.name)}, card.name || card.text, card.text)
      }));
      const best = cards
        .filter((card) => card.matchScore > 0)
        .sort((left, right) => right.matchScore - left.matchScore || Number(Boolean(right.avgPriceCny)) - Number(Boolean(left.avgPriceCny)))[0] || null;
      return JSON.stringify({
        url: location.href,
        title: document.title,
        blocked: location.hostname.includes("account.dianping.com") || location.hostname.includes("verify.meituan.com"),
        best
      });
    })()`),
  );
}

function parseDetailPage(fallbackPrice) {
  return JSON.parse(
    runChromeJs(`(() => {
      const text = document.body ? document.body.innerText : "";
      const priceMatch = text.match(/¥\\s*(\\d{2,5})\\/人/) || text.match(/人均\\s*[¥￥:]?\\s*(\\d{2,5})/);
      const recommended = [];
      const marker = text.indexOf("网友推荐");
      if (marker >= 0) {
        const segment = text.slice(marker, marker + 800).split(/菜单\\(|评价\\(|去大众点评App查看/)[0];
        segment.split("\\n").map((line) => line.trim()).forEach((line) => {
          if (!line || /推荐菜|查看更多|网友推荐|\\d+人推荐/.test(line)) return;
          if (line.length <= 24) recommended.push(line);
        });
      }
      return JSON.stringify({
        url: location.href,
        title: document.title,
        avgPriceCny: priceMatch ? Number(priceMatch[1]) : ${Number.isFinite(fallbackPrice) ? fallbackPrice : "null"},
        recommendedDishes: recommended.slice(0, 5)
      });
    })()`),
  );
}

async function resolveAppShopId(shopUuid) {
  setActiveTabUrl(`https://m.dianping.com/shopshare/${encodeURIComponent(shopUuid)}`);
  const state = await waitForReady(shopUuid);
  if (state.blocked) return { blocked: true, appShopId: "" };

  const result = JSON.parse(
    runChromeJs(`(() => {
      const html = document.documentElement ? document.documentElement.outerHTML : "";
      if (location.hostname.includes("verify.meituan.com") || location.hostname.includes("account.dianping.com")) {
        return JSON.stringify({ blocked: true, appShopId: "" });
      }
      const patterns = [
        /shopinfo\\?shopId=(\\d+)/i,
        /shopid=(\\d+)/i,
        /"id":(\\d+),[\\s\\S]{0,3000}"shopUuid":/i,
        /"id":(\\d+),[\\s\\S]{0,3000}"shopuuid":/i
      ];
      let appShopId = "";
      for (const pattern of patterns) {
        const value = html.match(pattern)?.[1];
        if (value && /^\\d+$/.test(value)) {
          appShopId = value;
          break;
        }
      }
      return JSON.stringify({
        blocked: false,
        url: location.href,
        title: document.title,
        appShopId
      });
    })()`),
  );

  return {
    blocked: Boolean(result.blocked),
    appShopId: typeof result.appShopId === "string" && /^\d+$/.test(result.appShopId) ? result.appShopId : "",
  };
}

async function enrichOne(restaurant) {
  let search = null;
  for (const searchEntry of searchQueries(restaurant)) {
    const url = searchUrlForQuery(restaurant, searchEntry.query);
    setActiveTabUrl(url);
    await waitForReady("/search/keyword/", url);

    search = parseSearchPage(restaurant, searchEntry.requireBranch);
    if (search.blocked) return { status: "blocked" };
    if (search.best && search.best.matchScore >= 0.85) break;
    await pacingDelay(queryDelayMs, "next query");
  }

  if (!search?.best || search.best.matchScore < 0.85) return { status: "not_found" };

  setActiveTabUrl(search.best.href);
  let detail = null;
  try {
    await waitForReady("/shop/");
    detail = parseDetailPage(search.best.avgPriceCny);
  } catch {
    detail = null;
  }
  const detailUrl = detail?.url?.includes("/shop/") ? detail.url : search.best.href;
  const shopUuid = shopUuidFromUrl(detailUrl);
  const app = shopUuid ? await resolveAppShopId(shopUuid) : { blocked: false, appShopId: "" };
  if (app.blocked) return { status: "blocked" };
  return {
    status: "matched",
    record: sanitizeRecord({
      url: detailUrl,
      avgPriceCny: detail?.avgPriceCny ?? search.best.avgPriceCny,
      recommendedDishes: detail?.recommendedDishes ?? [],
      dianpingShopUuid: shopUuid,
      dianpingAppShopId: app.appShopId || undefined,
      dianpingAppUrl: shopUuid
        ? app.appShopId
          ? buildNumericAppUrl(shopUuid, app.appShopId)
          : buildFallbackAppUrl(shopUuid)
        : undefined,
    }),
  };
}

try {
  runChromeJs("JSON.stringify({ok:true})");
} catch (error) {
  console.error(
    "Chrome AppleScript JavaScript is disabled. Enable Chrome > View > Developer > Allow JavaScript from Apple Events, then rerun this script.",
  );
  exit(1);
}

try {
  const payload = readOutput();
  console.log(`chrome pacing: pagePoll=${pagePollMs}ms queryDelay=${queryDelayMs}ms restaurantDelay=${restaurantDelayMs}ms jitter=${jitterMs}ms verificationWait=${verificationWaitMs}ms verificationMaxWaits=${verificationMaxWaits}`);
  const restaurants = readRestaurants()
    .filter((restaurant) => !cityFilter || restaurant.city === cityFilter)
    .filter((restaurant) => !idFilter || restaurant.id === idFilter)
    .filter((restaurant) => !skipIds.has(restaurant.id))
    .filter((restaurant) => !missingOnly || !isSuccessfulRecord(payload.records[restaurant.id]))
    .slice(0, Number.isFinite(limit) ? limit : 490);
  assert(restaurants.length > 0, "No restaurants selected for Dianping enrichment");

  const successful = [];
  let completeSuccessCount = 0;
  for (const restaurant of restaurants) {
    const existing = payload.records[restaurant.id];
    if (!force && isSuccessfulRecord(existing)) {
      successful.push({ restaurant, record: existing, status: "existing" });
      completeSuccessCount += 1;
      console.log(`${restaurant.name}: skipped`);
      if (successLimit > 0 && completeSuccessCount >= successLimit) {
        writeVerification(successful);
        console.log(`success-limit reached: ${completeSuccessCount}`);
        break;
      }
      continue;
    }

    let result = await enrichOne(restaurant);
    for (let waitIndex = 0; result.status === "blocked" && waitIndex < verificationMaxWaits; waitIndex += 1) {
      writeVerification(successful);
      console.log(`${restaurant.name}: blocked, waiting for manual verification ${waitIndex + 1}/${verificationMaxWaits}`);
      await delay(verificationWaitMs);
      result = await enrichOne(restaurant);
    }
    if (result.status === "matched" && isSuccessfulRecord(result.record)) {
      payload.records[restaurant.id] = result.record;
      writeOutput(payload);
      successful.push({ restaurant, record: result.record, status: "matched" });
      completeSuccessCount += 1;
      console.log(`${restaurant.name}: matched`);
      if (successLimit > 0 && completeSuccessCount >= successLimit) {
        writeVerification(successful);
        console.log(`success-limit reached: ${completeSuccessCount}`);
        break;
      }
    } else if (result.status === "matched" && hasValues(result.record) && !requireComplete) {
      payload.records[restaurant.id] = result.record;
      writeOutput(payload);
      successful.push({ restaurant, record: result.record, status: "partial" });
      writeVerification(successful);
      console.log(`${restaurant.name}: partial`);
    } else if (result.status === "matched" && hasValues(result.record)) {
      successful.push({ restaurant, record: result.record, status: "incomplete_not_written" });
      writeVerification(successful);
      console.log(`${restaurant.name}: incomplete_not_written`);
    } else if (result.status === "blocked") {
      writeVerification(successful);
      console.log(`${restaurant.name}: blocked`);
      throw new Error("Dianping verification is blocking the current Chrome tab");
    } else {
      writeVerification(successful);
      console.log(`${restaurant.name}: ${result.status}`);
    }
    await pacingDelay(restaurantDelayMs, "next restaurant");
  }
  writeVerification(successful);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
