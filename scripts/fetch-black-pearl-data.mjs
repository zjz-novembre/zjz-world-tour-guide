import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env, exit } from "node:process";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const outputDir = join(root, "output", "sources");
const outputPath = join(outputDir, "black-pearl-guide.json");
const endpoint = "https://apimeishi.meituan.com/blackpearl/pc/rank/filterList";
const selectorEndpoint = "https://apimeishi.meituan.com/blackpearl/pc/rank/getSelectorList";
const blackPearlDetailBase = "https://blackpearl.meituan.com/restaurant-detail";
const requestHeaders = {
  "Content-Type": "application/json;charset=UTF-8",
  Origin: "https://blackpearl.meituan.com",
  Referer: "https://blackpearl.meituan.com/",
};

const cityCodeByName = {
  澳门: "macau",
  北京: "beijing",
  常州: "changzhou",
  成都: "chengdu",
  重庆: "chongqing",
  福州: "fuzhou",
  广州: "guangzhou",
  杭州: "hangzhou",
  济南: "jinan",
  昆明: "kunming",
  南昌: "nanchang",
  南京: "nanjing",
  南通: "nantong",
  宁波: "ningbo",
  青岛: "qingdao",
  泉州: "quanzhou",
  三亚: "sanya",
  厦门: "xiamen",
  汕头: "shantou",
  上海: "shanghai",
  深圳: "shenzhen",
  沈阳: "shenyang",
  石家庄: "shijiazhuang",
  顺德: "shunde",
  苏州: "suzhou",
  台北: "taipei",
  台州: "taizhou",
  天津: "tianjin",
  温州: "wenzhou",
  无锡: "wuxi",
  武汉: "wuhan",
  西安: "xian",
  香港: "hong-kong",
  扬州: "yangzhou",
  长沙: "changsha",
};

const provinceByCityName = {
  澳门: "澳门特别行政区",
  北京: "北京",
  常州: "江苏",
  成都: "四川",
  重庆: "重庆",
  福州: "福建",
  广州: "广东",
  杭州: "浙江",
  济南: "山东",
  昆明: "云南",
  南昌: "江西",
  南京: "江苏",
  南通: "江苏",
  宁波: "浙江",
  青岛: "山东",
  泉州: "福建",
  三亚: "海南",
  厦门: "福建",
  汕头: "广东",
  上海: "上海",
  深圳: "广东",
  沈阳: "辽宁",
  石家庄: "河北",
  顺德: "广东",
  苏州: "江苏",
  台北: "台湾",
  台州: "浙江",
  天津: "天津",
  温州: "浙江",
  无锡: "江苏",
  武汉: "湖北",
  西安: "陕西",
  香港: "香港特别行政区",
  扬州: "江苏",
  长沙: "湖南",
};

const coordinateOverridesByShopId = new Map(
  [
    [
      "717508529",
      {
        position: [120.103064, 30.263021],
        source: "amap",
        amapPoiId: "B0H2V5V8VI",
        address: "杭州西湖区西溪路588号珀莱雅大厦外广场1楼",
        district: "西湖区",
        poiName: "AmbreCiel珀·餐厅(珀莱雅大厦店)",
        poiAddress: "西溪路588号珀莱雅大厦一层中央广场",
      },
    ],
    [
      "1132783971",
      {
        position: [113.995926, 22.539033],
        source: "amap",
        amapPoiId: "B0JGVRAPVM",
        address: "深圳南山区侨城东路99号创意园深南电路大厦103b号",
        district: "南山区",
        poiName: "La Tablee·融合料理(创意园深南电路大厦店)",
        poiAddress: "侨城东路99号创意园深南电路大厦103b",
      },
    ],
    [
      "760141037",
      {
        position: [113.917413, 22.479845],
        source: "amap",
        amapPoiId: "B0KBLAY7PE",
        address: "深圳南山区望海路1187号海上世界文化艺术中心一楼105A",
        district: "南山区",
        poiName: "三生AFFINITÉ",
        poiAddress: "望海路1187号海上世界文化艺术中心一楼105A(1楼入口近东门处)",
      },
    ],
    [
      "1606858409",
      {
        position: [113.982136, 22.545702],
        source: "amap",
        amapPoiId: "B0G1340C4Z",
        address: "深圳市南山区沙河街道华侨城香山中街2-1号天鹅堡会所(欢乐谷后侧)",
        district: "南山区",
        poiName: "至正潮菜(华侨城店)",
        poiAddress: "华侨城香山中街2-2号(天鹅堡三期会所)",
      },
    ],
    [
      "1035418827",
      {
        position: [113.577467, 22.143994],
        source: "amap",
        amapPoiId: "B0J3S7VWUD",
        address: "澳门路氹体育馆大马路永利皇宫北名店街地面层",
        district: "路氹填海区",
        poiName: "谭卉",
        poiAddress: "澳门体育馆大马路永利皇宫",
      },
    ],
  ],
);

const traditionalMap = new Map(
  Object.entries({
    臺: "台",
    門: "门",
    麵: "面",
    館: "馆",
    樓: "楼",
    廳: "厅",
    龍: "龙",
    魚: "鱼",
    鮮: "鲜",
    飯: "饭",
    軒: "轩",
    閣: "阁",
    園: "园",
    寶: "宝",
    蘭: "兰",
    廣: "广",
    會: "会",
    風: "风",
    華: "华",
  }),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getAmapServiceKey() {
  const key = env.AMAP_SERVICE_KEY ?? env.AMAP_REST_KEY ?? "";
  assert(key.trim(), "Set AMAP_SERVICE_KEY to resolve non-MICHELIN Black Pearl coordinates");
  return key.trim();
}

function readMichelinRestaurants() {
  const databasePath = join(root, "database", "michelin-restaurants.sqlite");
  const sql = `
    SELECT
      id,
      name,
      english_name AS englishName,
      city_code AS city,
      city_name AS cityName,
      province,
      country,
      district,
      address,
      avg_price_cny AS costPerPersonCny,
      recommended_dishes_json AS recommendedDishesJson,
      dianping_url AS dianpingUrl,
      dianping_app_shop_id AS dianpingAppShopId,
      dianping_app_url AS dianpingAppUrl,
      cuisine,
      amap_poi_query AS poiQuery,
      longitude,
      latitude,
      coor_sys AS coorSys,
      coordinate_source AS coordinateSource,
      amap_poi_id AS amapPoiId,
      redirect_link AS mapsUrl,
      cover_image AS coverImageUrl,
      michelin_source_url AS sourceUrl
    FROM restaurants;
  `;
  const result = spawnSync("sqlite3", ["-json", databasePath, sql], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  assert(result.status === 0, result.stderr || "sqlite3 failed to read MICHELIN database");

  return JSON.parse(result.stdout || "[]").map((row) => ({
    ...row,
    position: [Number(row.longitude), Number(row.latitude)],
    topDishes: JSON.parse(row.recommendedDishesJson || "[]"),
  }));
}

async function postJson(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(18000),
  });
  assert(response.ok, `${url} failed: ${response.status}`);
  const payload = await response.json();
  assert(payload.code === 200, `${url} returned ${payload.code}: ${payload.message}`);
  return payload.data;
}

async function fetchSelector() {
  return postJson(selectorEndpoint, {
    pcSelectorRequest: {
      cityId: 0,
      diamondLevel: 0,
      selfCatId: 0,
      newRankShop: 0,
    },
    commonRequest: { language: "zh" },
  });
}

async function fetchList() {
  return postJson(endpoint, {
    pcRankListRequest: {
      cityId: 0,
      sortType: 1,
      lng: 0,
      lat: 0,
      selfCatId: -1,
      newRankShop: 0,
      diamondLevel: 0,
      pageNum: 1,
      pageSize: 500,
    },
    commonRequest: { language: "zh" },
  });
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/./g, (char) => traditionalMap.get(char) ?? char)
    .replace(/&/g, "and")
    .replace(/½/g, "12")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/餐厅|中餐厅|西餐厅|大酒店|酒店|宾馆|旗舰店|总店|分店|店/g, "")
    .replace(/[·•・.。'’`´"“”\-_—–:：,，/\\|+＋\s]/g, "")
    .replace(/[()（）\[\]【】{}]/g, "");
}

function baseName(value) {
  return String(value ?? "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchMichelinRestaurant(shop, michelinRestaurants) {
  const cityName = cityNameFromShop(shop);
  const candidates = michelinRestaurants.filter((restaurant) => restaurant.cityName === cityName);
  const normalizedShop = normalizeText(shop.shopName);
  const normalizedBaseShop = normalizeText(baseName(shop.shopName));

  const scored = candidates
    .map((restaurant) => {
      const names = [restaurant.name, restaurant.englishName].filter(Boolean);
      const nameScores = names.map((name) => scoreName(normalizedShop, normalizeText(name)));
      const baseScores = names.map((name) => scoreName(normalizedBaseShop, normalizeText(baseName(name))));
      return {
        restaurant,
        score: Math.max(...nameScores, ...baseScores),
      };
    })
    .filter((item) => item.score >= 0.88)
    .sort((left, right) => right.score - left.score);

  if (!scored.length) return null;
  if (scored[0].score < 1 && scored[1] && scored[0].score === scored[1].score) return null;
  return scored[0];
}

function scoreName(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 3 && right.includes(left)) return 0.96;
  if (right.length >= 3 && left.includes(right)) return 0.94;
  return charSimilarity(left, right) >= 0.92 ? 0.9 : 0;
}

function charSimilarity(a, b) {
  const left = new Set([...a]);
  const right = new Set([...b]);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const char of left) {
    if (right.has(char)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

function cityNameFromShop(shop) {
  return String(shop.shopCountryCityName ?? "").split(/\s+/).at(-1);
}

function cityCode(cityName) {
  const code = cityCodeByName[cityName];
  assert(code, `Missing Black Pearl city code for ${cityName}`);
  return code;
}

function province(cityName) {
  const value = provinceByCityName[cityName];
  assert(value, `Missing Black Pearl province for ${cityName}`);
  return value;
}

function diamondLevelToLevel(diamondLevel) {
  if (diamondLevel === 3) return "three-stars";
  if (diamondLevel === 2) return "two-stars";
  return "one-star";
}

function parsePrice(value) {
  const number = String(value ?? "").replace(/[^\d]/g, "");
  return number ? Number(number) : null;
}

function blackPearlSourceUrl(shopId) {
  const url = new URL(blackPearlDetailBase);
  url.searchParams.set("shopId", String(shopId));
  return url.toString();
}

function dianpingUrl(shopId) {
  return `https://www.dianping.com/shop/${encodeURIComponent(String(shopId))}`;
}

function dianpingAppUrl(shopId) {
  const originalUrl = `https://m.dianping.com/shop/${encodeURIComponent(String(shopId))}`;
  const schema = `dianping://shopinfo?id=${encodeURIComponent(String(shopId))}&utm=w_mshop_auto`;
  return `https://link.dianping.com/universal-link?originalUrl=${encodeURIComponent(originalUrl)}&schema=${encodeURIComponent(schema)}`;
}

function parseLocation(value) {
  if (!value) return null;
  const [lng, lat] = String(value)
    .split(",")
    .map((item) => Number(item));
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

async function fetchAmapJson(url, attempt = 1) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const payload = await response.json();
  if (payload.status === "1") return payload;
  if (attempt < 4 && ["10020", "10021", "10022", "10029"].includes(String(payload.infocode))) {
    await delay(800 * attempt);
    return fetchAmapJson(url, attempt + 1);
  }
  throw new Error(`${payload.info ?? "AMap request failed"} (${payload.infocode ?? "unknown"})`);
}

async function searchAmapPoi(key, shop) {
  const cityName = cityNameFromShop(shop);
  const url = new URL("https://restapi.amap.com/v3/place/text");
  url.searchParams.set("key", key);
  url.searchParams.set("keywords", `${shop.shopName} ${cityName}`);
  url.searchParams.set("city", cityName);
  url.searchParams.set("citylimit", "true");
  url.searchParams.set("offset", "10");
  url.searchParams.set("page", "1");
  url.searchParams.set("extensions", "base");
  url.searchParams.set("output", "json");

  const payload = await fetchAmapJson(url);
  const pois = Array.isArray(payload.pois) ? payload.pois : [];
  const normalizedShop = normalizeText(shop.shopName);
  const candidates = pois
    .map((poi) => ({
      poi,
      position: parseLocation(poi.location),
      score: scoreName(normalizedShop, normalizeText(poi.name)),
      food: /餐饮|美食|中餐|西餐|日本料理|外国餐厅|咖啡|酒吧|Restaurant/i.test(
        `${poi.type ?? ""} ${poi.typecode ?? ""}`,
      ),
    }))
    .filter((candidate) => candidate.position)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return Number(right.food) - Number(left.food);
    });

  return candidates.find((candidate) => candidate.score >= 0.88) ?? candidates.find((candidate) => candidate.food) ?? candidates[0] ?? null;
}

async function geocodeCity(key, cityName) {
  const url = new URL("https://restapi.amap.com/v3/geocode/geo");
  url.searchParams.set("key", key);
  url.searchParams.set("address", `${cityName}市`);
  url.searchParams.set("city", cityName);
  url.searchParams.set("output", "json");
  const payload = await fetchAmapJson(url);
  const geocode = payload.geocodes?.[0];
  return geocode ? parseLocation(geocode.location) : null;
}

async function resolveCoordinate(key, shop, matched) {
  const coordinateOverride = coordinateOverridesByShopId.get(String(shop.shopId));
  if (coordinateOverride) return coordinateOverride;

  if (matched?.restaurant?.position) {
    return {
      position: matched.restaurant.position,
      source: "michelin",
      amapPoiId: matched.restaurant.amapPoiId,
      address: matched.restaurant.address,
      district: matched.restaurant.district,
      poiName: null,
      poiAddress: null,
    };
  }

  const poi = await searchAmapPoi(key, shop);
  if (poi?.position) {
    return {
      position: poi.position,
      source: "amap",
      amapPoiId: poi.poi.id,
      address: typeof poi.poi.address === "string" ? poi.poi.address : undefined,
      district: typeof poi.poi.adname === "string" ? poi.poi.adname : "",
      poiName: poi.poi.name,
      poiAddress: poi.poi.address,
    };
  }

  const cityName = cityNameFromShop(shop);
  const position = await geocodeCity(key, cityName);
  assert(position, `${shop.shopName} missing coordinate`);
  return {
    position,
    source: "amap",
    amapPoiId: undefined,
    address: undefined,
    district: "",
    poiName: null,
    poiAddress: null,
  };
}

function cityCounts(records) {
  return records.reduce((acc, record) => {
    acc[record.city] = (acc[record.city] ?? 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const key = getAmapServiceKey();
  const michelinRestaurants = readMichelinRestaurants();
  const selector = await fetchSelector();
  const list = await fetchList();
  const chinaShops = list.shopList.filter((shop) => shop.shopCountryCityName?.startsWith("中国 "));
  const shopCountsByCity = Object.fromEntries(
    selector.countryCityInfoList
      .find((country) => country.countryName === "中国")
      .cityList.map((city) => [cityCode(city.cityName), city.shopCount]),
  );
  const records = [];
  const diagnostics = [];

  for (const shop of chinaShops) {
    const cityName = cityNameFromShop(shop);
    const city = cityCode(cityName);
    const matched = matchMichelinRestaurant(shop, michelinRestaurants);
    const coordinate = await resolveCoordinate(key, shop, matched);
    const sourceUrl = blackPearlSourceUrl(shop.shopId);
    const michelin = matched?.restaurant;
    const topDishes = michelin?.topDishes?.length
      ? michelin.topDishes
      : [shop.cateName || "黑珍珠"];
    const avgPriceCny = michelin?.costPerPersonCny ?? parsePrice(shop.avgPriceDisplay);
    const link = michelin?.mapsUrl ?? sourceUrl;

    records.push({
      id: `bp-cn-${city}-${shop.shopId}`,
      blackPearlShopId: String(shop.shopId),
      blackPearlName: shop.shopName,
      name: michelin?.name ?? shop.shopName,
      englishName: michelin?.englishName,
      city,
      cityName,
      province: michelin?.province ?? province(cityName),
      country: "中国",
      district: coordinate.district ?? michelin?.district ?? "",
      address: coordinate.address ?? michelin?.address,
      level: diamondLevelToLevel(shop.diamondLevel),
      diamondLevel: shop.diamondLevel,
      avgPriceCny,
      blackPearlPriceDisplay: shop.avgPriceDisplay,
      topDishes,
      cuisine: michelin?.cuisine ?? shop.cateName ?? "黑珍珠",
      poiQuery: `${shop.shopName} ${cityName}`,
      position: coordinate.position,
      coorSys: "GCJ-02",
      coordinateSystem: "GCJ-02",
      coordinateSource: coordinate.source,
      amapPoiId: coordinate.amapPoiId,
      mapsUrl: link,
      coverImageUrl: michelin?.coverImageUrl ?? shop.imageUrl,
      sourceUrl,
      blackPearlSourceUrl: sourceUrl,
      michelinSourceUrl: michelin?.sourceUrl,
      matchedMichelinId: michelin?.id,
      dianpingUrl: michelin?.dianpingUrl ?? dianpingUrl(shop.shopId),
      dianpingAppShopId: michelin?.dianpingAppShopId ?? String(shop.shopId),
      dianpingAppUrl: michelin?.dianpingAppUrl ?? dianpingAppUrl(shop.shopId),
      redirectLink: link,
    });

    diagnostics.push({
      shopId: shop.shopId,
      blackPearlName: shop.shopName,
      city,
      matchedMichelinId: michelin?.id ?? null,
      matchedMichelinName: michelin?.name ?? null,
      matchScore: matched?.score ?? null,
      coordinateSource: coordinate.source,
      amapPoiId: coordinate.amapPoiId ?? null,
      amapPoiName: coordinate.poiName,
      amapPoiAddress: coordinate.poiAddress,
    });

    if (records.length % 25 === 0) {
      console.log(`[black-pearl] ${records.length}/${chinaShops.length}`);
    }
    await delay(90);
  }

  records.sort((left, right) => {
    const cityDelta = left.city.localeCompare(right.city);
    if (cityDelta !== 0) return cityDelta;
    const levelDelta = right.diamondLevel - left.diamondLevel;
    if (levelDelta !== 0) return levelDelta;
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        source: "Black Pearl Restaurant Guide public website list API",
        listEndpoint: endpoint,
        total: records.length,
        globalTotal: list.totalCount,
        cityCounts: cityCounts(records),
        officialChinaCityCounts: shopCountsByCity,
        diamondCounts: records.reduce((acc, record) => {
          acc[record.diamondLevel] = (acc[record.diamondLevel] ?? 0) + 1;
          return acc;
        }, {}),
        matchedMichelinCount: records.filter((record) => record.matchedMichelinId).length,
        records,
        diagnostics,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`[write] ${outputPath}`);
  console.log(`[summary] blackPearlChina=${records.length} matchedMichelin=${records.filter((record) => record.matchedMichelinId).length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
