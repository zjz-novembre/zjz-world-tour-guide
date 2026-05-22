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
  coordinate_source TEXT NOT NULL CHECK (
    coordinate_source IN ('amap', 'michelin', 'manual')
  ),
  black_pearl_level TEXT NOT NULL CHECK (
    black_pearl_level IN ('three-stars', 'two-stars', 'one-star')
  ),
  black_pearl_diamond INTEGER NOT NULL CHECK (black_pearl_diamond IN (1, 2, 3)),
  black_pearl_price_display TEXT,
  cuisine TEXT,
  avg_price_cny INTEGER,
  recommended_dishes_json TEXT NOT NULL DEFAULT '[]',
  dianping_url TEXT,
  dianping_app_shop_id TEXT,
  dianping_app_url TEXT,
  redirect_link TEXT NOT NULL,
  black_pearl_source_url TEXT NOT NULL,
  black_pearl_shop_id TEXT NOT NULL,
  black_pearl_name TEXT NOT NULL,
  matched_michelin_id TEXT,
  michelin_source_url TEXT,
  amap_poi_id TEXT,
  amap_maps_url TEXT,
  amap_poi_query TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_black_pearl_city_level
  ON restaurants (city_code, black_pearl_level);

CREATE INDEX IF NOT EXISTS idx_black_pearl_avg_price
  ON restaurants (city_code, avg_price_cny);

CREATE INDEX IF NOT EXISTS idx_black_pearl_geo
  ON restaurants (city_code, longitude, latitude);

CREATE INDEX IF NOT EXISTS idx_black_pearl_shop_id
  ON restaurants (black_pearl_shop_id);
