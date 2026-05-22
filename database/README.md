# Michelin Restaurant Database

Local MVP SQLite contract for the restaurant list.

## Fields

- `id`: canonical restaurant id derived from the MICHELIN restaurant URL path:
  `cn-{michelinProvinceSegment}-{michelinCitySegment}-{michelinRestaurantSlug}`.
- `cover_image`: official MICHELIN cover image URL.
- `name`: restaurant name.
- `english_name`: optional English or romanized name.
- `city_code`: internal city key.
- `city_name`: city display name.
- `province`: province, municipality, or special administrative region.
- `country`: country display name.
- `district`: district display name.
- `address`: street-level address when available.
- `latitude`: AMap-ready latitude.
- `longitude`: AMap-ready longitude.
- `coor_sys`: coordinate system; China MVP value is `GCJ-02`.
- `coordinate_source`: coordinate provenance; current China-wide build uses `michelin` official coordinates converted to GCJ-02.
- `michelin_level`: `three-stars`, `two-stars`, `one-star`, `bib-gourmand`, or `selected`.
- `michelin_price_band`: official MICHELIN price band, such as `¥`, `¥¥`, or `¥¥¥`.
- `cuisine`: official MICHELIN cuisine/category label, not recommended dishes.
- `avg_price_cny`: Dianping per-person price when matched; empty when Dianping has no usable value. The UI falls back to `michelin_price_band` for display only.
- `recommended_dishes_json`: JSON array of up to 5 recommendation labels; Dianping dishes when matched, otherwise MICHELIN cuisine/category labels.
- `dianping_url`: matched Dianping shop URL when available.
- `redirect_link`: primary outbound row action; Dianping URL when matched, otherwise official MICHELIN restaurant URL.
- `michelin_source_url`: official MICHELIN restaurant detail page.
- `amap_poi_id`: matched AMap POI id when available.
- `amap_maps_url`: AMap search/detail URL.
- `amap_poi_query`: AMap query string.
- `created_at`: local row creation timestamp.
- `updated_at`: local row update timestamp.

## Notes

`latitude` and `longitude` are the only persisted coordinate pair. `coor_sys` is not the data source; it tells the map which coordinate system the numbers use. `coordinate_source` records where those numbers came from.

Browser relay / Computer Use operational details stay outside the main table in `output/sources/dianping-enrichment.json`. The SQLite table only keeps the values the UI needs.

`michelin_source_url` is the restaurant page. Edition/news list pages are not stored in the MVP table.

Restaurant IDs are canonicalized from MICHELIN source paths instead of local crawl order or display names. Dianping enrichment must be keyed by this canonical `id`; the database build does not use legacy four-city ID fallbacks.

## Build

```bash
npm run db:build
npm run db:verify
```

## Dianping Enrichment

`npm run data:dianping` writes only main-table enrichment values to `output/sources/dianping-enrichment.json`.
Each record may contain only `avgPriceCny`, `recommendedDishes`, and `url`.
`npm run db:build` promotes those values into `avg_price_cny`, `recommended_dishes_json`, and `dianping_url`. When Dianping dishes are unavailable, `recommended_dishes_json` falls back to MICHELIN's official cuisine/category labels; MICHELIN price bands are never converted into synthetic per-person prices.
