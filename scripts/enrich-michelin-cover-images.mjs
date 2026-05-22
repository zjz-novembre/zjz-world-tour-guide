import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwd, env, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const sourcePath = join(root, "src", "data", "restaurants.ts");
const outputPath = join(root, "output", "sources", "michelin-cover-images.json");
const chromeCandidates = [
  env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);
const chromeBin = chromeCandidates.find((candidate) => existsSync(candidate));

const cityConfigs = [
  {
    code: "xiamen",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/fujian-province/xiamen_1031934/restaurants",
    expectedCount: 42,
  },
  {
    code: "shanghai",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/shanghai-municipality/shanghai/restaurants",
    expectedCount: 154,
  },
  {
    code: "chengdu",
    guideUrl: "https://guide.michelin.com/sg/zh_CN/chengdu-municipality/chengdu/restaurants",
    expectedCount: 76,
  },
  {
    code: "hong-kong",
    guideUrl: "https://guide.michelin.com/hk/zh_HK/hong-kong-region/hong-kong/restaurants",
    expectedCount: 218,
  },
];

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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(typeof address === "object" && address, "Could not allocate port");
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`HTTP endpoint did not become ready: ${url}`);
}

async function openCdpSocket(debugPort) {
  const listUrl = `http://127.0.0.1:${debugPort}/json/list`;
  await waitForHttp(listUrl);

  let target = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const targets = await fetch(listUrl).then((response) => response.json());
    target = targets.find((item) => item.type === "page");
    if (target?.webSocketDebuggerUrl) break;
    await delay(250);
  }

  assert(target?.webSocketDebuggerUrl, "Could not find Chrome page target");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;

    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
      return;
    }
    resolve(message.result);
  });

  function send(method, params = {}) {
    const id = (nextId += 1);
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  return { socket, send };
}

function pageUrl(baseUrl, page) {
  if (page === 1) return baseUrl;
  return `${baseUrl.replace(/\/$/, "")}/page/${page}`;
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[·'"’‘`.,，。_\-\s]/g, "");
}

function normalizeImageUrl(url) {
  if (!url) return "";
  const [first] = String(url).split(",");
  return first.replace(/^http:\/\//, "https://").replace(/&amp;/g, "&").trim();
}

function isMichelinCover(url) {
  return url.includes("cloudimg.io") && url.includes("__gmpics");
}

async function navigateAndReadCards(cdp, url, expectedCards) {
  await cdp.send("Page.navigate", { url });
  await delay(2500);

  for (let y = 0; y <= 9000; y += 500) {
    await cdp.send("Runtime.evaluate", { expression: `window.scrollTo(0, ${y})` });
    await delay(140);
  }
  await cdp.send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
  await delay(350);

  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const cards = [...document.querySelectorAll(".restaurant__list-row.js-restaurant__list_items .js-restaurant__list_item")];
      return {
        url: location.href,
        title: document.title,
        bodyText: document.body?.innerText?.slice(0, 600) ?? "",
        cards: cards.map((card) => {
          const titleAnchor = card.querySelector(".card__menu-content--title a[href]");
          const name = (titleAnchor?.textContent ?? "").replace(/\\s+/g, " ").trim();
          const href = titleAnchor ? new URL(titleAnchor.getAttribute("href"), location.origin).href : "";
          const html = card.innerHTML;
          const attributeImages = [...card.querySelectorAll("*")]
            .flatMap((element) => [...element.attributes].map((attribute) => attribute.value))
            .flatMap((value) => String(value).split(","))
            .map((value) => value.trim())
            .filter((value) => value.includes("cloudimg.io") && value.includes("__gmpics"));
          const htmlImages = [...html.matchAll(/https:\\/\\/[^"'<>\\s,]+__gmpics[^"'<>\\s,]+/g)]
            .map((match) => match[0]);
          const coverImageUrl = [...attributeImages, ...htmlImages][0] ?? "";
          const lat = Number(card.dataset.lat);
          const lng = Number(card.dataset.lng);

          return {
            name,
            href,
            coverImageUrl,
            michelinPosition: Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null
          };
        }).filter((card) => card.name && card.href)
      };
    })()`,
    returnByValue: true,
  });

  const value = result.result.value;
  assert(
    value.cards.length >= expectedCards,
    `${url} expected at least ${expectedCards} cards, got ${value.cards.length}`,
  );
  return value.cards.map((card) => ({
    ...card,
    coverImageUrl: normalizeImageUrl(card.coverImageUrl),
  }));
}

async function scrapeOfficialListCards() {
  assert(chromeBin, "Chrome or Chromium is required for MICHELIN browser relay extraction");
  const debugPort = await getFreePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "michelin-covers-"));
  const chrome = spawn(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${debugPort}`,
      "--window-size=1440,1600",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );

  try {
    const cdp = await openCdpSocket(debugPort);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const cards = [];
    for (const cityConfig of cityConfigs) {
      const pageCount = Math.ceil(cityConfig.expectedCount / 48);
      for (let page = 1; page <= pageCount; page += 1) {
        const expectedCards = Math.min(48, cityConfig.expectedCount - (page - 1) * 48);
        const pageCards = await navigateAndReadCards(
          cdp,
          pageUrl(cityConfig.guideUrl, page),
          expectedCards,
        );
        pageCards.forEach((card) => cards.push({ ...card, city: cityConfig.code }));
        console.log(`[michelin-cover] ${cityConfig.code} page ${page}/${pageCount}: ${pageCards.length}`);
      }
    }

    await cdp.send("Browser.close").catch(() => undefined);
    cdp.socket.close();
    return cards;
  } finally {
    chrome.kill("SIGTERM");
    await delay(300);
    rmSync(userDataDir, { force: true, maxRetries: 8, recursive: true, retryDelay: 100 });
  }
}

async function main() {
  const restaurants = readRestaurants();
  const cards = await scrapeOfficialListCards();
  const byHref = new Map(cards.map((card) => [card.href, card]));
  const byCityName = new Map(cards.map((card) => [`${card.city}:${normalizeName(card.name)}`, card]));
  const missing = [];
  const nextRestaurants = restaurants.map((restaurant) => {
    const card =
      byHref.get(restaurant.sourceUrl) ??
      byCityName.get(`${restaurant.city}:${normalizeName(restaurant.name)}`);
    const coverImageUrl = card?.coverImageUrl ?? "";

    if (!isMichelinCover(coverImageUrl)) {
      missing.push(`${restaurant.city}:${restaurant.name}`);
      return restaurant;
    }

    return {
      ...restaurant,
      coverImageUrl,
    };
  });

  assert(missing.length === 0, `Missing official MICHELIN cover images: ${missing.slice(0, 12).join(", ")}`);

  mkdirSync(join(root, "output", "sources"), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        source: "MICHELIN Guide list pages via browser relay data-bookmark-image attributes",
        count: cards.length,
        matchedRestaurantCount: nextRestaurants.length,
        records: cards,
      },
      null,
      2,
    )}\n`,
  );
  writeRestaurants(nextRestaurants);
  console.log(`[write] ${outputPath}`);
  console.log(`[write] ${sourcePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
