import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { cwd, env, exit } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = cwd();
const viteBin = join(root, "node_modules", ".bin", "vite");
const databasePath = join(root, "database", "michelin-restaurants.sqlite");
const sourcePayloadPath = join(root, "output", "sources", "michelin-guide-china.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(typeof address === "object" && address, "Could not allocate port");
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`HTTP endpoint did not become ready: ${url}`);
}

function stopProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(resolveTimer);
      resolve();
    };
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 800);
    const resolveTimer = setTimeout(finish, 2500);

    child.once("exit", finish);
    child.kill("SIGTERM");
  });
}

function readSqliteCount() {
  const result = spawnSync(
    "sqlite3",
    ["-json", databasePath, "SELECT COUNT(*) AS count FROM restaurants;"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

  if (result.error) throw result.error;
  assert(result.status === 0, result.stderr || "sqlite3 count query failed");
  return JSON.parse(result.stdout)[0].count;
}

function isDianpingAppUrl(value) {
  return (
    typeof value === "string" &&
    (value.startsWith("https://link.dianping.com/universal-link?") ||
      value.startsWith("https://m.dianping.com/shopshare/"))
  );
}

function hasValidDianpingAppShopId(restaurant) {
  return typeof restaurant.dianpingAppShopId === "string" && /^\d+$/.test(restaurant.dianpingAppShopId);
}

let server = null;

try {
  assert(existsSync(viteBin), "Run npm install before DB API verification");
  assert(existsSync(databasePath), "Run npm run db:build before DB API verification");
  assert(existsSync(sourcePayloadPath), "Run node scripts/fetch-michelin-data.mjs before DB API verification");
  const sourcePayload = JSON.parse(readFileSync(sourcePayloadPath, "utf8"));

  const appUrl = env.APP_URL ?? `http://127.0.0.1:${await getFreePort()}/`;
  if (!env.APP_URL) {
    const { port } = new URL(appUrl);
    server = spawn(
      viteBin,
      ["--host", "127.0.0.1", "--port", port, "--strictPort"],
      {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }

  await waitForHttp(appUrl);
  const apiUrl = new URL("/api/restaurants", appUrl);
  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });

  assert(response.ok, `DB API returned HTTP ${response.status}`);
  const payload = await response.json();
  const sqliteCount = readSqliteCount();

  assert(payload.source === "sqlite", "DB API did not report sqlite source");
  assert(payload.database === "database/michelin-restaurants.sqlite", "DB API database label is wrong");
  assert(payload.count === sqliteCount, `DB API count ${payload.count} != SQLite count ${sqliteCount}`);
  assert(Array.isArray(payload.restaurants), "DB API restaurants payload is not an array");
  assert(payload.restaurants.length === sqliteCount, "DB API restaurants length does not match SQLite");
  assert(sqliteCount === sourcePayload.total, `Expected ${sourcePayload.total} restaurants, got ${sqliteCount}`);

  const bad = payload.restaurants.find((restaurant) => {
    return (
      !restaurant.coverImageUrl ||
      !Array.isArray(restaurant.position) ||
      restaurant.position.length !== 2 ||
      restaurant.coorSys !== "GCJ-02" ||
      !["amap", "michelin", "manual"].includes(restaurant.coordinateSource) ||
      !Array.isArray(restaurant.topDishes) ||
      !Array.isArray(restaurant.dianpingRecommendedDishes) ||
      (restaurant.dianpingUrl && !isDianpingAppUrl(restaurant.dianpingAppUrl)) ||
      (restaurant.dianpingAppUrl?.startsWith("https://link.dianping.com/universal-link?") &&
        (!hasValidDianpingAppShopId(restaurant) ||
          !restaurant.dianpingAppUrl.includes(encodeURIComponent(`shopinfo?id=${restaurant.dianpingAppShopId}`)))) ||
      (restaurant.dianpingAppUrl?.startsWith("https://m.dianping.com/shopshare/") && restaurant.dianpingAppShopId) ||
      (!restaurant.dianpingUrl && restaurant.dianpingAppUrl && !hasValidDianpingAppShopId(restaurant)) ||
      (restaurant.dianpingAppShopId && !restaurant.dianpingAppUrl)
    );
  });
  assert(!bad, `DB API returned an incomplete restaurant: ${bad?.id ?? "unknown"}`);

  const removedKeys = [
    "dianpingShopId",
    "dianpingShopUuid",
    "dianpingSearchUrl",
    "dianpingMatchName",
    "dianpingMatchAddress",
    "dianpingMatchScore",
    "dianpingRating",
    "dianpingReviewCount",
    "dianpingFetchStatus",
    "dianpingFetchError",
    "dianpingFetchedAt",
    "dianpingRawPath",
  ];
  const leaked = payload.restaurants.find((restaurant) =>
    removedKeys.some((key) => Object.prototype.hasOwnProperty.call(restaurant, key)),
  );
  assert(!leaked, `DB API leaked removed Dianping metadata: ${leaked?.id ?? "unknown"}`);

  console.log(
    `DB API verification passed: ${payload.count} restaurants from ${payload.database}, source=${payload.source}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
} finally {
  await stopProcess(server);
}
