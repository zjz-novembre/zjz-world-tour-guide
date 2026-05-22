import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env, exit } from "node:process";

const root = cwd();
const sourcePath = join(root, "src", "data", "restaurants.ts");
const sourcePayloadPath = join(root, "output", "sources", "michelin-guide-china.json");
const csvPath = env.MICHELIN_GITHUB_CSV || "/tmp/michelin_my_maps.csv";
const csvUrl =
  "https://cdn.jsdelivr.net/gh/ngshiheng/michelin-my-maps@main/data/michelin_my_maps.csv";

const locationToCity = {
  "Beijing, Chinese Mainland": "beijing",
  "Guangzhou, Chinese Mainland": "guangzhou",
  "Chengdu, Chinese Mainland": "chengdu",
  "Fuzhou, Chinese Mainland": "fuzhou",
  "Xiamen, Chinese Mainland": "xiamen",
  "Quanzhou, Chinese Mainland": "quanzhou",
  "Ningde, Chinese Mainland": "ningde",
  "Shanghai, Chinese Mainland": "shanghai",
  "Nanjing, Chinese Mainland": "nanjing",
  "Suzhou, Chinese Mainland": "suzhou",
  "Yangzhou, Chinese Mainland": "yangzhou",
  "Hangzhou, Chinese Mainland": "hangzhou",
  "Hong Kong, Hong Kong SAR China": "hong-kong",
  Macau: "macau",
};

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

function parseCsv(source) {
  const rows = [];
  let row = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(current);
      current = "";
    } else if (char === "\n") {
      row.push(current.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[^\p{Script=Han}a-z0-9]/gu, "");
}

function ensureCsv() {
  if (existsSync(csvPath)) return;
  execFileSync(
    "curl",
    ["-4", "-sS", "-L", "--max-time", "240", "-o", csvPath, csvUrl],
    { stdio: "inherit" },
  );
}

function buildAddressMap(csv) {
  const rows = parseCsv(csv);
  const header = rows[0];
  const indexByName = Object.fromEntries(header.map((name, index) => [name, index]));
  const addresses = new Map();

  rows.slice(1).forEach((row) => {
    const city = locationToCity[row[indexByName.Location]];
    const address = row[indexByName.Address];
    if (!city || !address) return;
    addresses.set(`${city}:${normalizeName(row[indexByName.Name])}`, address);
  });

  return addresses;
}

try {
  ensureCsv();
  const csv = readFileSync(csvPath, "utf8");
  const addressByKey = buildAddressMap(csv);
  const restaurants = readRestaurants();
  let enriched = 0;
  const nextRestaurants = restaurants.map((restaurant) => {
    if (restaurant.address) return restaurant;
    const address = addressByKey.get(`${restaurant.city}:${normalizeName(restaurant.name)}`);
    if (!address) return restaurant;
    enriched += 1;
    return { ...restaurant, address };
  });

  writeRestaurants(nextRestaurants);

  if (existsSync(sourcePayloadPath)) {
    const payload = JSON.parse(readFileSync(sourcePayloadPath, "utf8"));
    payload.records = nextRestaurants;
    payload.githubAddressFallback = {
      source: "ngshiheng/michelin-my-maps CSV, used only when official detail pages were WAF-challenged",
      csvUrl,
      matchedRows: enriched,
    };
    writeFileSync(sourcePayloadPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  console.log(`[github-addresses] enriched ${enriched}/${restaurants.length} restaurants`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
