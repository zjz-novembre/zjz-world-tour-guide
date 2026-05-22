import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cwd, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const targetPath = join(root, "output", "sources", "dianping-app-shopid-targets.json");
const enrichmentPath = join(root, "output", "sources", "dianping-enrichment.json");
const verificationPath = join(root, "output", "sources", "dianping-app-shopid-verification.html");

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

const limit = Number(args.get("limit") ?? "0");
const force = args.get("force") === "1" || args.get("force") === "true";
const delayMs = Number(args.get("delay-ms") ?? "30000");
const pagePollMs = Number(args.get("page-poll-ms") ?? "500");
const verificationWaitMs = Number(args.get("verification-wait-ms") ?? "30000");
const verificationMaxWaits = Number(args.get("verification-max-waits") ?? "60");
const useExistingUrl = args.get("use-existing-url") === "1" || args.get("use-existing-url") === "true";

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeEnrichment(payload) {
  writeFileSync(enrichmentPath, `${JSON.stringify({ records: payload.records ?? {} }, null, 2)}\n`);
}

function runOsascript(script, argv = []) {
  const result = spawnSync("osascript", ["-", ...argv], {
    input: script,
    encoding: "utf8",
    maxBuffer: 24 * 1024 * 1024,
    timeout: 60 * 1000,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "osascript failed");
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

async function waitForPage(expected) {
  let state = null;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    state = JSON.parse(
      runChromeJs(`(() => {
        const text = document.body ? document.body.innerText : "";
        const html = document.documentElement ? document.documentElement.outerHTML : "";
        return JSON.stringify({
          ready: document.readyState,
          url: location.href,
          title: document.title,
          text: text.slice(0, 1000),
          length: html.length,
          hasSearchResultMarker: html.includes("shop-all-list") || text.includes("共为您找到") || text.includes("很抱歉"),
          blocked: location.hostname.includes("verify.meituan.com") || location.hostname.includes("account.dianping.com") || html.includes("spiderindefence")
        });
      })()`),
    );
    if (state.blocked) return state;
    if (expected.includes("/search/keyword/") && state.url.includes(expected) && state.hasSearchResultMarker) {
      return state;
    }
    if (!expected.includes("/search/keyword/") && state.url.includes(expected) && state.length > 1000 && (state.ready === "complete" || state.text.length > 80)) {
      return state;
    }
    await delay(pagePollMs);
  }
  return state ?? { blocked: false, url: "", title: "", text: "", length: 0 };
}

function compact(value) {
  return String(value ?? "")
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
    .replace(/[葉]/g, "叶")
    .replace(/[潤]/g, "润")
    .replace(/[開]/g, "开")
    .replace(/[飯]/g, "饭")
    .replace(/[蝦]/g, "虾")
    .replace(/[禮]/g, "礼")
    .replace(/[東]/g, "东")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[()·•|'"’‘`.,，。_\\\-\s]/g, "");
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

function cleanDianpingName(value) {
  return String(value ?? "")
    .replace(/[（(]\s*显示也改成这个名字\s*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueQueries(queries) {
  const seen = new Set();
  return queries
    .map((query) => String(query ?? "").replace(/\s+/g, " ").trim())
    .filter((query) => {
      const key = compact(query);
      if (key.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function queryVariants(target) {
  const raw = cleanDianpingName(target.dianpingName);
  const noParentheses = raw.replace(/[（(][^）)]*[）)]/g, " ").replace(/\s+/g, " ").trim();
  const spacedParentheses = raw.replace(/[（(]/g, " ").replace(/[）)]/g, " ").replace(/\s+/g, " ").trim();
  const noLatin = raw
    .replace(/[A-Za-z][A-Za-z0-9&'’.\-\s]*[A-Za-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const noLatinNoParentheses = noParentheses
    .replace(/[A-Za-z][A-Za-z0-9&'’.\-\s]*[A-Za-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const splitParts = raw
    .split(/[·•|]/)
    .map((part) => part.replace(/[（(][^）)]*[）)]/g, " ").replace(/\s+/g, " ").trim());
  const chineseRuns = [...raw.matchAll(/[\u3400-\u9fff]{2,}/g)].map((match) => match[0]);

  return uniqueQueries([
    raw,
    spacedParentheses,
    noParentheses,
    noLatin,
    noLatinNoParentheses,
    ...splitParts,
    ...chineseRuns,
  ]);
}

function searchUrl(target, query) {
  const cityId = cityIds[target.city];
  if (!cityId) throw new Error(`No Dianping city id for ${target.city}`);
  return `https://www.dianping.com/search/keyword/${cityId}/0_${encodeURIComponent(query)}`;
}

async function resolveShopUrl(target, existingUrl) {
  if (useExistingUrl && shopUuidFromUrl(existingUrl)) return { url: existingUrl };

  for (const query of queryVariants(target)) {
    const url = searchUrl(target, query);
    setActiveTabUrl(url);
    const state = await waitForPage("/search/keyword/");
    if (state.blocked) return { blocked: true };

    const result = JSON.parse(
      runChromeJs(`(() => {
      const expected = ${JSON.stringify(compact(query))};
      const canonical = ${JSON.stringify(compact(cleanDianpingName(target.dianpingName)))};
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
        .replace(/[葉]/g, "叶")
        .replace(/[潤]/g, "润")
        .replace(/[開]/g, "开")
        .replace(/[飯]/g, "饭")
        .replace(/[蝦]/g, "虾")
        .replace(/[禮]/g, "礼")
        .replace(/[東]/g, "东")
        .replace(/[（]/g, "(")
        .replace(/[）]/g, ")")
        .replace(/[()·•|'"’‘\`.,，。_\\\\\\-\\s]/g, "");
      const anchors = [...document.querySelectorAll('a[href*="/shop/"]')];
      const candidates = anchors.map((anchor) => {
        const href = new URL(anchor.getAttribute("href"), location.origin).href;
        const container = anchor.closest("li") || anchor.closest(".txt") || anchor.parentElement;
        const text = (container?.innerText || anchor.innerText || "").replace(/\\s+/g, " ").trim();
        const name = (anchor.textContent || "").replace(/\\s+/g, " ").trim();
        const haystack = compact([name, text].join(" "));
        let score = 0;
        if (compact(name) === expected) score = 1;
        else if (canonical.length >= 2 && compact(name) === canonical) score = 0.99;
        else if (haystack.includes(expected)) score = 0.96;
        else if (canonical.length >= 2 && haystack.includes(canonical)) score = 0.94;
        else if (expected.includes(compact(name)) && compact(name).length >= 4) score = 0.88;
        return { href, name, text, score };
      }).filter((candidate) => candidate.score >= 0.88);
      candidates.sort((left, right) => right.score - left.score);
      return JSON.stringify(candidates[0] || null);
    })()`),
    );
    if (result?.href) {
      return { url: result.href, matchName: result.name, matchText: result.text, query };
    }
  }

  return { notFound: true };
}

async function resolveAppShopId(shopUuid) {
  const url = `https://m.dianping.com/shopshare/${encodeURIComponent(shopUuid)}`;
  setActiveTabUrl(url);
  const state = await waitForPage(shopUuid);
  if (state.blocked) return { blocked: true, appShopId: "" };

  const result = JSON.parse(
    runChromeJs(`(() => {
      const html = document.documentElement ? document.documentElement.outerHTML : "";
      const shopUuid = ${JSON.stringify(shopUuid)};
      if (!location.href.includes(shopUuid) && !decodeURIComponent(location.href).includes(shopUuid)) {
        return JSON.stringify({ appShopId: "", stalePage: true, url: location.href });
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
      return JSON.stringify({ url: location.href, title: document.title, appShopId });
    })()`),
  );
  return { blocked: false, appShopId: result.appShopId || "" };
}

function mergeTargetRecord(existing, target, url, shopUuid, appShopId) {
  const recommendedDishes = Array.isArray(target.recommendedDishes)
    ? target.recommendedDishes.filter((dish) => typeof dish === "string" && dish.trim()).slice(0, 5)
    : [];
  const next = { ...(existing ?? {}) };
  next.url = url;
  next.dianpingShopUuid = shopUuid;
  if (Number.isFinite(target.avgPriceCny)) next.avgPriceCny = Math.round(target.avgPriceCny);
  if (recommendedDishes.length >= 5) next.recommendedDishes = recommendedDishes;
  if (appShopId) {
    next.dianpingAppShopId = appShopId;
    delete next.dianpingNumericShopId;
    next.dianpingAppUrl = buildNumericAppUrl(shopUuid, appShopId);
  } else {
    delete next.dianpingAppShopId;
    delete next.dianpingNumericShopId;
    next.dianpingAppUrl = buildFallbackAppUrl(shopUuid);
  }
  return next;
}

function writeVerification(rows) {
  mkdirSync(join(root, "output", "sources"), { recursive: true });
  const body = rows
    .map(
      ({ target, status, url, appShopId }, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(target.cityName)}</td>
        <td>${escapeHtml(target.michelinName)}</td>
        <td>${escapeHtml(target.dianpingName)}</td>
        <td>${escapeHtml(appShopId ?? "")}</td>
        <td>${url ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : ""}</td>
        <td>${escapeHtml(status)}</td>
      </tr>`,
    )
    .join("");
  writeFileSync(
    verificationPath,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Dianping App Shop ID</title><style>body{font:14px -apple-system,BlinkMacSystemFont,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}a{color:#9f231f}</style><table><thead><tr><th>#</th><th>城市</th><th>米其林名</th><th>大众点评名</th><th>app shopId</th><th>URL</th><th>状态</th></tr></thead><tbody>${body}</tbody></table></html>\n`,
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function main() {
  runChromeJs("JSON.stringify({ok:true})");
  const targetPayload = readJson(targetPath, { targets: [] });
  const enrichment = readJson(enrichmentPath, { records: {} });
  const selected = targetPayload.targets
    .filter((target) => target.id)
    .filter((target) => force || !enrichment.records?.[target.id]?.dianpingAppShopId)
    .slice(0, limit > 0 ? limit : undefined);
  const verificationRows = [];
  let completed = 0;

  for (const target of selected) {
    let result = null;
    for (let waitIndex = 0; waitIndex <= verificationMaxWaits; waitIndex += 1) {
      const existing = enrichment.records[target.id] ?? {};
      const resolvedUrl = await resolveShopUrl(target, existing.url);
      if (resolvedUrl.blocked) {
        console.log(`${target.cityName} ${target.dianpingName}: blocked, waiting ${waitIndex + 1}/${verificationMaxWaits}`);
        writeVerification(verificationRows);
        await delay(verificationWaitMs);
        continue;
      }
      if (!resolvedUrl.url) {
        result = { status: "not_found" };
        break;
      }
      const shopUuid = shopUuidFromUrl(resolvedUrl.url);
      const idResult = await resolveAppShopId(shopUuid);
      if (idResult.blocked) {
        console.log(`${target.cityName} ${target.dianpingName}: shop blocked, waiting ${waitIndex + 1}/${verificationMaxWaits}`);
        writeVerification(verificationRows);
        await delay(verificationWaitMs);
        continue;
      }
      const appShopId = idResult.appShopId;
      enrichment.records[target.id] = mergeTargetRecord(existing, target, resolvedUrl.url, shopUuid, appShopId);
      writeEnrichment(enrichment);
      result = {
        status: appShopId ? "matched" : "fallback",
        url: resolvedUrl.url,
        appShopId,
      };
      break;
    }

    result ??= { status: "blocked" };
    completed += result.status === "matched" ? 1 : 0;
    verificationRows.push({ target, ...result });
    writeVerification(verificationRows);
    console.log(`${target.cityName} ${target.dianpingName}: ${result.status}${result.appShopId ? ` ${result.appShopId}` : ""} (${completed} matched)`);
    if (delayMs > 0) await delay(delayMs);
  }

  console.log(`Dianping app shop ID enrichment complete: selected=${selected.length}, matched=${completed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
