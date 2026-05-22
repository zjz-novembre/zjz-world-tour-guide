import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cwd, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const targetPath = join(root, "output", "sources", "dianping-app-shopid-targets.json");
const enrichmentPath = join(root, "output", "sources", "dianping-enrichment.json");
const verificationPath = join(root, "output", "sources", "dianping-target-details-verification.html");

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

function shopUuidFromUrl(url) {
  return String(url ?? "").match(/\/shop\/([^/?#]+)/)?.[1] ?? "";
}

async function waitForShopPage(shopUuid) {
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
          text: text.slice(0, 1200),
          length: html.length,
          blocked: location.hostname.includes("verify.meituan.com") || location.hostname.includes("account.dianping.com") || html.includes("spiderindefence")
        });
      })()`),
    );
    if (state.blocked) return state;
    const expectedPage =
      state.url.includes(`/shopshare/${shopUuid}`) ||
      state.url.includes(`/shop/${shopUuid}`) ||
      decodeURIComponent(state.url).includes(`/shop/${shopUuid}`);
    const hasDetailText = /网友推荐|推荐菜|人均|评价|条¥|\/人/.test(state.text);
    if (expectedPage && state.length > 1000 && (state.ready === "complete" || hasDetailText)) return state;
    await delay(pagePollMs);
  }
  return state ?? { blocked: false, url: "", title: "", text: "", length: 0 };
}

function parseDetailPage() {
  return JSON.parse(
    runChromeJs(`(() => {
      const text = document.body ? document.body.innerText : "";
      const compactLine = (line) => String(line || "").replace(/\\s+/g, " ").trim();
      const priceMatch =
        text.match(/¥\\s*(\\d{1,5})\\s*\\/人/) ||
        text.match(/人均\\s*[¥￥:]?\\s*(\\d{1,5})/) ||
        text.match(/\\d+条\\s*¥\\s*(\\d{1,5})\\s*\\/人/);
      const avgPriceCny = priceMatch ? Number(priceMatch[1]) : null;

      const blocks = [];
      const markers = ["网友推荐", "推荐菜"];
      for (const marker of markers) {
        const index = text.indexOf(marker);
        if (index >= 0) {
          blocks.push(text.slice(index, index + 1400));
        }
      }
      if (!blocks.length) blocks.push(text.slice(0, 2500));

      const recommendedDishes = [];
      const seen = new Set();
      for (const block of blocks) {
        const segment = block.split(/菜单\\(|评价\\(|去大众点评App查看|小伙伴们还喜欢|商户信息|写评价/)[0];
        const lines = segment.split("\\n").map(compactLine).filter(Boolean);
        for (const line of lines) {
          if (/推荐菜|网友推荐|查看更多|打开App|去大众点评|菜单|评价/.test(line)) continue;
          if (/^\\d+人推荐$/.test(line) || /^\\d+$/.test(line)) continue;
          if (/^[★\\d.条¥\\/人口味环境服务:：\\s]+$/.test(line)) continue;
          if (line.length < 2 || line.length > 28) continue;
          if (/人均|团购|代金券|抢购|随时退|过期自动退|营业|停车|地址|电话|距离|附近|热门榜/.test(line)) continue;
          const key = line.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          recommendedDishes.push(line);
          if (recommendedDishes.length >= 5) break;
        }
        if (recommendedDishes.length >= 5) break;
      }

      return JSON.stringify({
        url: location.href,
        title: document.title,
        avgPriceCny,
        recommendedDishes: recommendedDishes.slice(0, 5),
        textSample: text.slice(0, 600)
      });
    })()`),
  );
}

function isComplete(record) {
  return Boolean(
    record?.url &&
      Number.isFinite(record.avgPriceCny) &&
      Array.isArray(record.recommendedDishes) &&
      record.recommendedDishes.filter(Boolean).length >= 5,
  );
}

function writeVerification(rows) {
  mkdirSync(join(root, "output", "sources"), { recursive: true });
  const body = rows
    .map(
      ({ target, status, avgPriceCny, recommendedDishes, url }, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(target.cityName)}</td>
        <td>${escapeHtml(target.michelinName)}</td>
        <td>${escapeHtml(target.dianpingName)}</td>
        <td>${escapeHtml(avgPriceCny ?? "")}</td>
        <td>${escapeHtml((recommendedDishes ?? []).join(" / "))}</td>
        <td>${url ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : ""}</td>
        <td>${escapeHtml(status)}</td>
      </tr>`,
    )
    .join("");
  writeFileSync(
    verificationPath,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Dianping Target Details</title><style>body{font:14px -apple-system,BlinkMacSystemFont,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}a{color:#9f231f}</style><table><thead><tr><th>#</th><th>城市</th><th>米其林名</th><th>大众点评名</th><th>人均</th><th>推荐菜</th><th>URL</th><th>状态</th></tr></thead><tbody>${body}</tbody></table></html>\n`,
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
    .filter((target) => {
      const record = enrichment.records?.[target.id];
      return record?.url && (force || !isComplete(record));
    })
    .slice(0, limit > 0 ? limit : undefined);

  const verificationRows = [];
  let completed = 0;
  for (const target of selected) {
    const record = enrichment.records[target.id];
    const shopUuid = shopUuidFromUrl(record.url);
    if (!shopUuid) {
      verificationRows.push({ target, status: "missing_url" });
      continue;
    }

    let result = null;
    for (let waitIndex = 0; waitIndex <= verificationMaxWaits; waitIndex += 1) {
      setActiveTabUrl(`https://m.dianping.com/shopshare/${encodeURIComponent(shopUuid)}`);
      const state = await waitForShopPage(shopUuid);
      if (state.blocked) {
        console.log(`${target.cityName} ${target.dianpingName}: blocked, waiting ${waitIndex + 1}/${verificationMaxWaits}`);
        writeVerification(verificationRows);
        await delay(verificationWaitMs);
        continue;
      }
      const parsed = parseDetailPage();
      const dishes = Array.isArray(parsed.recommendedDishes)
        ? parsed.recommendedDishes.filter((dish) => typeof dish === "string" && dish.trim()).slice(0, 5)
        : [];
      if (Number.isFinite(parsed.avgPriceCny)) record.avgPriceCny = Math.round(parsed.avgPriceCny);
      if (dishes.length >= 5) record.recommendedDishes = dishes;
      writeEnrichment(enrichment);
      const complete = isComplete(record);
      result = {
        status: complete ? "complete" : "partial",
        avgPriceCny: record.avgPriceCny,
        recommendedDishes: record.recommendedDishes ?? [],
        url: record.url,
      };
      if (complete) completed += 1;
      break;
    }
    result ??= { status: "blocked", url: record.url };
    verificationRows.push({ target, ...result });
    writeVerification(verificationRows);
    console.log(
      `${target.cityName} ${target.dianpingName}: ${result.status} price=${result.avgPriceCny ?? ""} dishes=${result.recommendedDishes?.length ?? 0} (${completed} complete)`,
    );
    if (delayMs > 0) await delay(delayMs);
  }
  console.log(`Dianping target detail enrichment complete: selected=${selected.length}, complete=${completed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
