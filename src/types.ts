export type MichelinLevel =
  | "three-stars"
  | "two-stars"
  | "one-star"
  | "bib-gourmand"
  | "selected";

export type CostBand =
  | "all"
  | "under-50"
  | "50-100"
  | "100-200"
  | "200-500"
  | "500-plus";

export type CityCode = string;

export type CityOption = {
  value: CityCode;
  label: string;
  cityName: string;
  province: string;
  country: string;
  amapCity: string;
  center: [number, number];
  mapZoom: number;
  offlineScale: number;
};

export type Restaurant = {
  id: string;
  name: string;
  englishName?: string;
  city: CityCode;
  cityName: string;
  province: string;
  country: string;
  district: string;
  address?: string;
  level: MichelinLevel;
  costPerPersonCny?: number;
  michelinPrice: string;
  topDishes: string[];
  dianpingUrl?: string;
  dianpingAppShopId?: string;
  dianpingAppUrl?: string;
  dianpingAvgPriceCny?: number;
  dianpingRecommendedDishes?: string[];
  cuisine: string;
  poiQuery: string;
  position?: [number, number];
  coorSys?: "GCJ-02";
  coordinateSystem?: "GCJ-02";
  coordinateSource?: "amap" | "michelin" | "manual";
  amapPoiId?: string;
  mapsUrl: string;
  coverImageUrl?: string;
  sourceUrl: string;
  sourceEditionUrl?: string;
};

export type RestaurantFilters = {
  city: CityCode;
  costBands: CostBand[];
  levels: MichelinLevel[];
};

export type UserLocation = {
  position: [number, number];
  heading: number | null;
};

export type GuideId = "michelin" | "black-pearl";

export type GuideConfig = {
  id: GuideId;
  brand: string;
  documentTitle: string;
  apiPath: string;
  defaultCity: CityCode;
  levelFilterLabel: string;
  levelColumnLabel: string;
  levelOptions: { value: MichelinLevel | "all"; label: string }[];
  levelLabels: Record<MichelinLevel, string>;
  levelRank: Record<MichelinLevel, number>;
  primaryPinIcon: string;
  primaryPinClassName: string;
};
