# Lite Restaurant Data Handoff

这份包用于把 Lite Michelin / Black Pearl 的数据库、源数据和大众点评补全脚本搬到另一台电脑继续跑。

## 包内关键文件

- `database/michelin-restaurants.sqlite`: 米其林主数据库。
- `database/black-pearl-restaurants.sqlite`: 黑珍珠主数据库。
- `database/schema.sql`: 米其林 SQLite schema。
- `database/black-pearl-schema.sql`: 黑珍珠 SQLite schema。
- `src/data/restaurants.ts`: 米其林前端源数据，也是米其林 DB build 的主输入。
- `output/sources/dianping-enrichment.json`: 大众点评补全中间态。这里保存 URL、人均、推荐菜、app shop id、app 跳转链接等。
- `output/sources/black-pearl-guide.json`: 黑珍珠源数据，也是黑珍珠 DB build 的主输入。
- `output/sources/michelin-guide-china.json`: 米其林官方中国榜单聚合源数据。
- `output/sources/michelin-cover-images.json`: 米其林官方封面图补全源数据。
- `output/sources/amap-coordinate-refresh.json`: 高德 GCJ-02 坐标补全记录。
- `output/sources/dianping-*-verification.html`: 之前各城市抓取/验证报告。
- `output/sources/dianping-app-shopid-targets.json`: app shop id / 详情补全的目标列表。
- `scripts/enrich-dianping-data.mjs`: 独立 Chrome profile 的大众点评抓取脚本。
- `scripts/enrich-dianping-current-chrome.mjs`: 复用当前已登录 Chrome 的低频抓取脚本。
- `scripts/enrich-dianping-target-details.mjs`: 已有目标列表的详情页补全脚本。
- `scripts/enrich-dianping-app-shop-ids.mjs`: 数字 app shop id 补全脚本。
- `scripts/enrich-dianping-app-links.mjs`: 根据 app shop id 生成大众点评 app 跳转链接。
- `scripts/build-restaurant-db.mjs`: 从 `src/data/restaurants.ts` 和 `dianping-enrichment.json` 重建米其林 DB。
- `scripts/build-black-pearl-db.mjs`: 从 `black-pearl-guide.json` 重建黑珍珠 DB。

## 没有打包的内容

- `node_modules`: 在新机器上执行 `npm install` 重新安装。
- `.browser/dianping`: 这里是本机 Chrome profile/cookies/session，不建议搬运，也不保证跨机器可用。新电脑上重新登录大众点评。
- `dist`: 构建产物，执行 `npm run build` 可重新生成。
- `.omx`: 本机工作流状态，不影响数据脚本运行。

## 新电脑准备

1. 安装 Node.js 20+。
2. 确认系统有 `sqlite3` 命令：

```bash
sqlite3 --version
```

3. 进入解压后的目录安装依赖：

```bash
npm install
```

4. 如果要跑 Chrome 自动化，安装 Google Chrome，并在 Chrome 菜单打开：

```text
View > Developer > Allow JavaScript from Apple Events
```

5. 在 Chrome 手动登录大众点评，确认能正常打开城市页和店铺详情页。

## 只验证/重建数据库

```bash
npm run db:build
npm run db:build:black-pearl
npm run db:verify
```

米其林 DB 重建逻辑：只有完整的大众点评记录才会进入主 DB 的大众点评字段。完整记录通常需要：

- `url`
- `avgPriceCny`
- `recommendedDishes`，默认至少 5 个；少数人工确认的短推荐菜记录用 `acceptShortRecommendedDishes: true`

不完整记录会留在 `output/sources/dianping-enrichment.json`，但不会覆盖主 DB 的关键字段。

## 推荐的低频抓取方式

优先用当前 Chrome 登录态脚本：

```bash
node scripts/enrich-dianping-current-chrome.mjs \
  --city=guangzhou \
  --missing-only=1 \
  --require-complete=1 \
  --success-limit=80 \
  --restaurant-delay-ms=30000 \
  --jitter-ms=8000 \
  --verification=output/sources/dianping-guangzhou-verification.html
```

常用参数：

- `--city=guangzhou`: 城市代码。
- `--missing-only=1`: 只补缺失大众点评完整数据的餐厅。
- `--require-complete=1`: 只有 URL、人均、推荐菜完整才写入 enrichment。
- `--success-limit=80`: 成功补全多少条后停。
- `--restaurant-delay-ms=30000`: 每家餐厅之间至少 30 秒。
- `--jitter-ms=8000`: 额外随机等待，降低连续访问节奏。
- `--verification=...html`: 输出本批次验证报告。
- `--force=1`: 强制覆盖已有记录，谨慎使用。
- `--id=<restaurant_id>`: 只补某一家。
- `--skip-id=id1,id2`: 跳过指定餐厅。

抓完后执行：

```bash
npm run db:build
npm run db:build:black-pearl
```

## 独立 Chrome profile 登录方式

如果不想污染日常 Chrome profile，可以用独立 profile：

```bash
DIANPING_HEADFUL=1 \
DIANPING_PAUSE_ON_LOGIN=1 \
DIANPING_CHROME_USER_DATA_DIR=.browser/dianping \
node scripts/enrich-dianping-data.mjs --city=shanghai --limit=50
```

脚本会打开带界面的 Chrome。需要登录或验证时，手动处理完再继续。

## app shop id 和 app 跳转链接

先补 app shop id：

```bash
node scripts/enrich-dianping-app-shop-ids.mjs \
  --limit=50 \
  --delay-ms=30000 \
  --use-existing-url=1
```

再生成 app universal link：

```bash
node scripts/enrich-dianping-app-links.mjs --limit=200 --delay-ms=1000
```

最后重建 DB：

```bash
npm run db:build
npm run db:build:black-pearl
```

## 风控时的处理

- 不要并发跑多个脚本。
- 不要把 delay 降得太低；正常用 30 秒以上。
- 遇到验证页先停住，手动验证后再继续。
- 如果一直 403 / Forbidden，直接停，过几小时或换网络再跑。
- 不建议设置 `DIANPING_IGNORE_BLOCK=1` 连续硬冲。

## 当前数据规模

当前打包时：

- 米其林 DB: 1061 条。
- 黑珍珠 DB: 326 条。
- 大众点评 enrichment records: 721 条。
- 大众点评含 URL records: 721 条。
- 大众点评完整/人工确认 records: 716 条。
- 含数字 app shop id records: 134 条。

## 常用城市代码

- `shanghai`
- `beijing`
- `guangzhou`
- `chengdu`
- `hangzhou`
- `xiamen`
- `hong-kong`
- `macau`
- `nanjing`
- `suzhou`
- `yangzhou`
- `changzhou`
- `taizhou`
- `wenzhou`
- `fuzhou`
- `quanzhou`
- `ningde`
