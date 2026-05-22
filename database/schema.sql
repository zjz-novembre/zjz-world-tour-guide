PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  cover_image TEXT,
  name TEXT NOT NULL,
  english_name TEXT,
  city_code TEXT NOT NULL,
  city_name TEXT NOT NULL,
  province TEXT NOT NULL,
  country TEXT NOT NULL,
  district TEXT,
  address TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  coor_sys TEXT NOT NULL DEFAULT 'GCJ-02' CHECK (coor_sys IN ('GCJ-02')),
  coordinate_source TEXT NOT NULL DEFAULT 'amap' CHECK (
    coordinate_source IN ('amap', 'michelin', 'manual')
  ),
  michelin_price_band TEXT,
  michelin_level TEXT NOT NULL CHECK (
    michelin_level IN ('three-stars', 'two-stars', 'one-star', 'bib-gourmand', 'selected')
  ),
  cuisine TEXT,
  avg_price_cny INTEGER,
  recommended_dishes_json TEXT NOT NULL DEFAULT '[]',
  dianping_url TEXT,
  dianping_app_shop_id TEXT,
  dianping_app_url TEXT,
  redirect_link TEXT NOT NULL,
  michelin_source_url TEXT NOT NULL,
  amap_poi_id TEXT,
  amap_maps_url TEXT,
  amap_poi_query TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_restaurants_city_level
  ON restaurants (city_code, michelin_level);

CREATE INDEX IF NOT EXISTS idx_restaurants_avg_price
  ON restaurants (city_code, avg_price_cny);

CREATE INDEX IF NOT EXISTS idx_restaurants_geo
  ON restaurants (city_code, longitude, latitude);
