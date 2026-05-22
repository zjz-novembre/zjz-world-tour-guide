import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const xlsxPath = process.argv[2] ?? join(root, "output", "sources", "numbers-export", "补全列表.xlsx");
const outputPath = process.argv[3] ?? join(root, "output", "sources", "dianping-app-shopid-targets.json");
const sourcePath = join(root, "src", "data", "restaurants.ts");

const cityCodeByName = new Map([
  ["北京", "beijing"],
  ["广州", "guangzhou"],
  ["成都", "chengdu"],
  ["福州", "fuzhou"],
  ["厦门", "xiamen"],
  ["泉州", "quanzhou"],
  ["宁德", "ningde"],
  ["上海", "shanghai"],
  ["南京", "nanjing"],
  ["苏州", "suzhou"],
  ["扬州", "yangzhou"],
  ["常州", "changzhou"],
  ["杭州", "hangzhou"],
  ["温州", "wenzhou"],
  ["台州", "taizhou"],
]);

const manualIdByCityAndName = new Map([
  ["福州|江南灶·荣府", "cn-fujian-province-fuzhou-1026814-jiangnan-wok-e2-80-a7rong"],
  ["福州|印象福清.醉福园", "cn-fujian-province-fuzhou-1026814-fuyuan"],
  ["厦门|兴旺海鲜城·荣廷荟（思明）", "cn-fujian-province-xiamen-1031934-xing-wang-seafood-rongting-hui-siming"],
  ["成都|老成都逸城三样面", "cn-chengdu-municipality-chengdu-lao-chengdu-san-yang-mian"],
  ["上海|夏宫", "cn-shanghai-municipality-shanghai-summer-palace-506733"],
  ["上海|玲珑", "cn-shanghai-municipality-shanghai-ling-long-1209951"],
]);

function readRestaurants() {
  const source = readFileSync(sourcePath, "utf8");
  const jsonStart = source.indexOf("= [") + 2;
  const jsonEnd = source.lastIndexOf("];");
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

function unzip(path) {
  return execFileSync("unzip", ["-p", xlsxPath, path], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function sharedStrings() {
  const xml = unzip("xl/sharedStrings.xml");
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((text) => decodeXml(text[1]))
      .join(""),
  );
}

function rows() {
  const strings = sharedStrings();
  const xml = unzip("xl/worksheets/sheet1.xml");
  return [...xml.matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = { row: Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? 0) };
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? cellMatch[2];
      const column = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      if (!column) continue;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const raw = (cellMatch[3] ?? "").match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      if (!raw) continue;
      row[column] = type === "s" ? strings[Number(raw)] : decodeXml(raw);
    }
    return row;
  });
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
    .replace(/[匚]/g, "口")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[()·•|'"’‘`.,，。_\\\-\s]/g, "");
}

function baseName(value) {
  return String(value ?? "").replace(/[（(].*?[）)]/g, "").replace(/\s+/g, " ").trim();
}

function matchRestaurant(target, restaurants) {
  const cityRestaurants = restaurants.filter((restaurant) => restaurant.cityName === target.cityName);
  const manualId = manualIdByCityAndName.get(`${target.cityName}|${target.michelinName}`);
  if (manualId) return cityRestaurants.find((restaurant) => restaurant.id === manualId) ?? null;
  const expected = compact(target.michelinName);
  const expectedBase = compact(baseName(target.michelinName));
  const scored = cityRestaurants
    .map((restaurant) => {
      const name = compact(restaurant.name);
      const base = compact(baseName(restaurant.name));
      let score = 0;
      if (name === expected) score = 1;
      else if (base === expectedBase) score = 0.98;
      else if (name.includes(expected) || expected.includes(name)) score = 0.94;
      else if (base.includes(expectedBase) || expectedBase.includes(base)) score = 0.9;
      return { restaurant, score };
    })
    .filter((entry) => entry.score >= 0.9)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.restaurant ?? null;
}

try {
  const restaurants = readRestaurants();
  let currentCity = "";
  const targets = [];
  for (const row of rows().filter((item) => item.row >= 3)) {
    if (row.A && cityCodeByName.has(row.A)) currentCity = row.A;
    const michelinName = row.B;
    const dianpingName = row.C;
    if (!currentCity || !michelinName || !dianpingName) continue;
    const dishes = ["E", "F", "G", "H", "I"]
      .map((column) => row[column])
      .filter((value) => typeof value === "string" && value.trim());
    const target = {
      row: row.row,
      city: cityCodeByName.get(currentCity),
      cityName: currentCity,
      michelinName,
      dianpingName,
      ...(Number.isFinite(Number(row.D)) ? { avgPriceCny: Number(row.D) } : {}),
      ...(dishes.length ? { recommendedDishes: dishes } : {}),
    };
    const restaurant = matchRestaurant(target, restaurants);
    targets.push({
      ...target,
      ...(restaurant
        ? {
            id: restaurant.id,
            restaurantName: restaurant.name,
          }
        : { matchStatus: "unmatched" }),
    });
  }

  mkdirSync(join(root, "output", "sources"), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        source: xlsxPath,
        generatedAt: new Date().toISOString(),
        count: targets.length,
        unmatched: targets.filter((target) => !target.id).length,
        targets,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Dianping backfill targets extracted: ${targets.length} rows, unmatched=${targets.filter((target) => !target.id).length}`);
  console.log(outputPath);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
