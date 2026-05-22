import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cwd, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const enrichmentPath = join(root, "output", "sources", "dianping-enrichment.json");
const userAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

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
const delayMs = Number(args.get("delay-ms") ?? "500");
const viaChrome = args.get("via") === "chrome" || args.get("chrome") === "1" || args.get("chrome") === "true";
const idFilter = String(args.get("id") ?? "").trim();
const pagePollMs = Number(args.get("page-poll-ms") ?? "500");

function readPayload() {
  return JSON.parse(readFileSync(enrichmentPath, "utf8"));
}

function writePayload(payload) {
  writeFileSync(enrichmentPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function shopUuidFromUrl(url) {
  return String(url ?? "").match(/\/shop\/([^/?#]+)/)?.[1] ?? "";
}

function isCompleteRecord(record) {
  return Boolean(
    record?.url &&
      Number.isFinite(record.avgPriceCny) &&
      Array.isArray(record.recommendedDishes) &&
      record.recommendedDishes.filter((dish) => typeof dish === "string" && dish.trim()).length >= 5,
  );
}

function buildNumericAppUrl(shopUuid, numericShopId) {
  const originalUrl = `https://m.dianping.com/shop/${encodeURIComponent(shopUuid)}`;
  const schema = `dianping://shopinfo?id=${encodeURIComponent(String(numericShopId))}&utm=w_mshop_auto`;
  return `https://link.dianping.com/universal-link?originalUrl=${encodeURIComponent(originalUrl)}&schema=${encodeURIComponent(schema)}`;
}

function appShopId(record) {
  const value = record?.dianpingAppShopId ?? record?.dianpingNumericShopId;
  return typeof value === "string" && /^\d+$/.test(value) ? value : "";
}

function buildFallbackAppUrl(shopUuid) {
  return `https://m.dianping.com/shopshare/${encodeURIComponent(shopUuid)}`;
}

function extractNumericShopId(html, shopUuid) {
  const escapedUuid = shopUuid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`shopinfo\\?shopId=(\\d+)[^"']*shopuuid=${escapedUuid}`, "i"),
    /dishAppSchema":"dianping:\/\/recommend\?shopid=(\d+)/i,
    /mapSchema":"dianping:\/\/mapnavigation\?shopid=(\d+)/i,
    new RegExp(`"id":(\\d+),[\\s\\S]{0,3000}"shopUuid":"${escapedUuid}"`, "i"),
    new RegExp(`"id":(\\d+),[\\s\\S]{0,3000}"shopuuid":"${escapedUuid}"`, "i"),
  ];

  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value && /^\d+$/.test(value)) return value;
  }

  return "";
}

async function fetchShopHtml(shopUuid) {
  const response = await fetch(`https://m.dianping.com/shopshare/${encodeURIComponent(shopUuid)}`, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function runOsascript(script, argv = []) {
  const result = spawnSync("osascript", ["-", ...argv], {
    input: script,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60 * 1000,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "osascript failed");
  return result.stdout.trim();
}

function setChromeUrl(url) {
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

async function resolveShopIdWithChrome(shopUuid) {
  const url = `https://m.dianping.com/shopshare/${encodeURIComponent(shopUuid)}`;
  setChromeUrl(url);
  let state = null;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    state = JSON.parse(
      runChromeJs(`(() => {
        const html = document.documentElement ? document.documentElement.outerHTML : "";
        return JSON.stringify({
          ready: document.readyState,
          url: location.href,
          title: document.title,
          length: html.length,
          blocked: location.hostname.includes("verify.meituan.com") || location.hostname.includes("account.dianping.com") || html.includes("spiderindefence")
        });
      })()`),
    );
    const expectedPage =
      typeof state.url === "string" &&
      (state.url.includes(`/shopshare/${shopUuid}`) ||
        state.url.includes(`/shop/${shopUuid}`) ||
        decodeURIComponent(state.url).includes(`/shop/${shopUuid}`));
    if (state.blocked || (expectedPage && state.ready === "complete" && state.length > 1000)) break;
    await delay(pagePollMs);
  }

  if (state?.blocked) {
    return { blocked: true, numericShopId: "" };
  }

  const result = JSON.parse(
    runChromeJs(`(() => {
      try {
        const html = document.documentElement ? document.documentElement.outerHTML : "";
        const shopUuid = ${JSON.stringify(shopUuid)};
        if (!location.href.includes(shopUuid) && !decodeURIComponent(location.href).includes(shopUuid)) {
          return JSON.stringify({ numericShopId: "", stalePage: true, url: location.href });
        }
        const patterns = [
          /shopinfo\\?shopId=(\\d+)/i,
          /shopid=(\\d+)/i,
          /"id":(\\d+),[\\s\\S]{0,3000}"shopUuid":/i,
          /"id":(\\d+),[\\s\\S]{0,3000}"shopuuid":/i
        ];
        let numericShopId = "";
        for (const pattern of patterns) {
          const value = html.match(pattern)?.[1];
          if (value && /^\\d+$/.test(value)) {
            numericShopId = value;
            break;
          }
        }
        return JSON.stringify({
          url: location.href,
          title: document.title,
          length: html.length,
          numericShopId
        });
      } catch (error) {
        return JSON.stringify({ numericShopId: "", error: String(error) });
      }
    })()`),
  );

  return { blocked: false, numericShopId: result.numericShopId || "" };
}

try {
  const payload = readPayload();
  const entries = Object.entries(payload.records ?? {}).filter(([, record]) => {
    if (idFilter && !payload.records[idFilter]) return false;
    if (!isCompleteRecord(record)) return false;
    if (!shopUuidFromUrl(record.url)) return false;
    return force || !record.dianpingAppUrl || !appShopId(record);
  });
  const filteredEntries = idFilter ? entries.filter(([id]) => id === idFilter) : entries;
  const selected = limit > 0 ? filteredEntries.slice(0, limit) : filteredEntries;
  let updated = 0;
  let numeric = 0;
  let fallback = 0;

  for (const [id, record] of selected) {
    const shopUuid = shopUuidFromUrl(record.url);
    try {
      const numericShopId = viaChrome
        ? (await resolveShopIdWithChrome(shopUuid)).numericShopId
        : extractNumericShopId(await fetchShopHtml(shopUuid), shopUuid);
      record.dianpingShopUuid = shopUuid;
      if (numericShopId) {
        record.dianpingAppShopId = numericShopId;
        delete record.dianpingNumericShopId;
        record.dianpingAppUrl = buildNumericAppUrl(shopUuid, numericShopId);
        numeric += 1;
      } else {
        delete record.dianpingAppShopId;
        delete record.dianpingNumericShopId;
        record.dianpingAppUrl = buildFallbackAppUrl(shopUuid);
        fallback += 1;
      }
      updated += 1;
      if (updated % 20 === 0) writePayload(payload);
      console.log(`${id}: ${numericShopId ? `numeric ${numericShopId}` : "fallback"}`);
    } catch (error) {
      record.dianpingShopUuid = shopUuid;
      delete record.dianpingAppShopId;
      delete record.dianpingNumericShopId;
      record.dianpingAppUrl = buildFallbackAppUrl(shopUuid);
      fallback += 1;
      updated += 1;
      console.log(`${id}: fallback (${error instanceof Error ? error.message : String(error)})`);
    }
    if (delayMs > 0) await delay(delayMs);
  }

  writePayload(payload);
  console.log(`Dianping app links enriched: updated=${updated}, numeric=${numeric}, fallback=${fallback}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
