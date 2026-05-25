import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterControl } from "./components/FilterControl";
import { ChevronDownIcon, ExternalLinkIcon, MapPinIcon, TagIcon } from "./components/icons";
import { MapView } from "./components/MapView";
import { RestaurantList } from "./components/RestaurantList";
import { cityOptions, costOptionsByGuide } from "./data/options";
import { guideConfigs, resolveGuideConfig } from "./data/guides";
import { wgs84ToGcj02 } from "./lib/coordinates";
import { filterRestaurants } from "./lib/filtering";
import { loadRestaurantsFrom } from "./lib/restaurants-api";
import type {
  CityCode,
  CityOption,
  CostBand,
  MichelinLevel,
  Restaurant,
  RestaurantFilters,
  UserLocation,
} from "./types";

const defaultFilters: RestaurantFilters = {
  city: "shanghai",
  costBands: [],
  levels: [],
};
const michelinGuideIcon = new URL("michelin-guide.svg", new URL(import.meta.env.BASE_URL, window.location.origin)).pathname;
const blackPearlDiamondIcon = new URL(
  "black-pearl-diamond-official-52.png",
  new URL(import.meta.env.BASE_URL, window.location.origin),
).pathname;
const blackPearlLogoIcon = new URL(
  "black-pearl-logo-official.png",
  new URL(import.meta.env.BASE_URL, window.location.origin),
).pathname;
type SelectedMarker = {
  id: string;
  mode: "small" | "detail";
};

export function App() {
  const guide = useMemo(() => resolveGuideConfig(window.location.pathname), []);
  const [filters, setFilters] = useState<RestaurantFilters>(() => ({
    ...defaultFilters,
    city: guide.defaultCity,
  }));
  const [selectedMarker, setSelectedMarker] = useState<SelectedMarker | null>(null);
  const [isListCollapsed, setIsListCollapsed] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "failed">("loading");
  const alternateGuide = guide.id === "black-pearl" ? guideConfigs.michelin : guideConfigs["black-pearl"];
  const alternateGuideIcon = guide.id === "black-pearl" ? michelinGuideIcon : blackPearlLogoIcon;
  const costOptions = useMemo(() => costOptionsByGuide[guide.id], [guide.id]);
  const alternateGuideHref = useMemo(() => {
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
    if (guide.id === "black-pearl") return baseUrl.pathname;
    return "/black-pearl";
  }, [guide.id]);

  useEffect(() => {
    document.title = guide.documentTitle;
  }, [guide.documentTitle]);

  useEffect(() => {
    let cancelled = false;

    loadRestaurantsFrom(guide.apiPath)
      .then((nextRestaurants) => {
        if (cancelled) return;
        setRestaurants(nextRestaurants);
        setDataStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setDataStatus("failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserLocation({
          heading: Number.isFinite(coords.heading) ? coords.heading : null,
          position: wgs84ToGcj02([coords.longitude, coords.latitude]),
        });
      },
      () => undefined,
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 8_000,
      },
    );
  }, [guide.apiPath]);

  const filteredRestaurants = useMemo(
    () => filterRestaurants(restaurants, filters, guide.levelRank),
    [filters, guide.levelRank, restaurants],
  );
  const activeCityOptions = useMemo(() => {
    if (!restaurants.length) return cityOptions;
    return buildCityOptions(restaurants);
  }, [restaurants]);
  const selectedCity =
    activeCityOptions.find((city) => city.value === filters.city) ??
    activeCityOptions[0] ??
    cityOptions[0];
  const selectedId = selectedMarker?.id ?? null;

  useEffect(() => {
    const allowedCostBands = new Set(costOptions.map((option) => option.value));
    setFilters((current) => {
      const nextCostBands = current.costBands.filter((costBand) => allowedCostBands.has(costBand));
      if (nextCostBands.length === current.costBands.length) return current;
      return { ...current, costBands: nextCostBands };
    });
  }, [costOptions]);

  useEffect(() => {
    if (!restaurants.length) return;
    if (restaurants.some((restaurant) => restaurant.city === filters.city)) return;
    const nextCity = activeCityOptions[0]?.value;
    if (nextCity) {
      setFilters((current) => ({ ...current, city: nextCity }));
      setSelectedMarker(null);
    }
  }, [activeCityOptions, filters.city, restaurants]);

  const handleMapSelect = useCallback((restaurantId: string) => {
    setSelectedMarker((current) =>
      current?.id === restaurantId && current.mode === "detail"
        ? null
        : {
            id: restaurantId,
            mode: "detail",
          },
    );
  }, []);

  const handleListSelect = useCallback((restaurantId: string) => {
    setSelectedMarker((current) =>
      current?.id === restaurantId && current.mode === "small"
        ? null
        : {
            id: restaurantId,
            mode: "small",
          },
    );
  }, []);

  const handleClearSelect = useCallback(() => {
    setSelectedMarker(null);
  }, []);

  const updateCost = useCallback((costBands: CostBand[]) => {
    setFilters((current) => ({
      ...current,
      costBands: costBands.filter((costBand) => costBand !== "all"),
    }));
    setSelectedMarker(null);
  }, []);

  const updateCity = useCallback((city: CityCode) => {
    setFilters((current) => ({ ...current, city }));
    setSelectedMarker(null);
  }, []);

  const updateLevel = useCallback((levels: Array<MichelinLevel | "all">) => {
    setFilters((current) => ({
      ...current,
      levels: levels.filter((level): level is MichelinLevel => level !== "all"),
    }));
    setSelectedMarker(null);
  }, []);

  return (
    <main
      className="app-shell"
      data-guide={guide.id}
      data-restaurant-source="sqlite"
      data-restaurant-status={dataStatus}
    >
      <section className="content-shell">
        <section className="map-section">
          <MapView
            key={selectedCity.value}
            city={selectedCity}
            onClearSelection={handleClearSelect}
            onSelect={handleMapSelect}
            restaurants={filteredRestaurants}
            selectedId={selectedId}
            selectedMode={selectedMarker?.mode ?? null}
            userLocation={userLocation}
            guide={guide}
          />
        </section>

        <div className="chrome-layer">
          <header className="topbar">
            <div className="brand" aria-label={guide.brand}>
              <span className="brand__word">{guide.brand}</span>
            </div>
            <a
              aria-label={`切换到${alternateGuide.brand}`}
              className="guide-switch"
              href={alternateGuideHref}
            >
              <img
                alt=""
                aria-hidden="true"
                className={`guide-switch__logo ${
                  alternateGuide.id === "black-pearl" ? "guide-switch__logo--black-pearl" : ""
                }`}
                src={alternateGuideIcon}
              />
              <ExternalLinkIcon className="guide-switch__icon" />
            </a>
          </header>

          <section className="filters" aria-label="筛选">
            <div className="filter-slot filter-slot--city">
              <FilterControl
                icon={MapPinIcon}
                label="城市"
                onChange={updateCity}
                options={activeCityOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={filters.city}
              />
            </div>
            <div className="filter-slot filter-slot--cost">
              <FilterControl
                icon={TagIcon}
                label="人均"
                multiple
                onValuesChange={updateCost}
                options={costOptions}
                values={filters.costBands}
              />
            </div>
            <div className="filter-slot filter-slot--level">
              <FilterControl
                iconSrc={guide.id === "black-pearl" ? blackPearlDiamondIcon : michelinGuideIcon}
                label={guide.levelFilterLabel}
                multiple
                onValuesChange={updateLevel}
                options={guide.levelOptions}
                values={filters.levels}
              />
            </div>
          </section>
        </div>

        <section className={isListCollapsed ? "list-section list-section--collapsed" : "list-section"}>
          <button
            aria-label={isListCollapsed ? "展开列表" : "收起列表"}
            className="restaurant-list-toggle"
            type="button"
            onClick={() => setIsListCollapsed((current) => !current)}
          >
            <ChevronDownIcon />
          </button>
          <RestaurantList
            onSelect={handleListSelect}
            restaurants={filteredRestaurants}
            selectedId={selectedId}
            guide={guide}
          />
        </section>
      </section>
    </main>
  );
}

function buildCityOptions(restaurants: Restaurant[]): CityOption[] {
  const staticByCode = new Map(cityOptions.map((city) => [city.value, city]));
  const grouped = new Map<CityCode, Restaurant[]>();

  restaurants.forEach((restaurant) => {
    if (!grouped.has(restaurant.city)) grouped.set(restaurant.city, []);
    grouped.get(restaurant.city)!.push(restaurant);
  });

  return [...grouped.entries()].map(([cityCode, cityRestaurants]) => {
    const staticCity = staticByCode.get(cityCode);
    if (staticCity) return staticCity;

    const first = cityRestaurants[0];
    const positioned = cityRestaurants.filter((restaurant) => restaurant.position);
    const center = positioned.length
      ? ([
          positioned.reduce((sum, restaurant) => sum + restaurant.position![0], 0) / positioned.length,
          positioned.reduce((sum, restaurant) => sum + restaurant.position![1], 0) / positioned.length,
        ] as [number, number])
      : ([0, 0] as [number, number]);

    return {
      value: cityCode,
      label: first.cityName,
      cityName: first.cityName,
      province: first.province,
      country: first.country,
      amapCity: first.cityName,
      center,
      mapZoom: positioned.length <= 3 ? 12.1 : 11.6,
      offlineScale: 900,
    };
  });
}
