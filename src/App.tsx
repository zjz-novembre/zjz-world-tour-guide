import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterControl } from "./components/FilterControl";
import { ExternalLinkIcon, MapPinIcon, TagIcon } from "./components/icons";
import { MapView } from "./components/MapView";
import { RestaurantList } from "./components/RestaurantList";
import { cityOptions, costOptions } from "./data/options";
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

export function App() {
  const guide = useMemo(() => resolveGuideConfig(window.location.pathname), []);
  const [filters, setFilters] = useState<RestaurantFilters>(() => ({
    ...defaultFilters,
    city: guide.defaultCity,
  }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "failed">("loading");
  const alternateGuide = guide.id === "black-pearl" ? guideConfigs.michelin : guideConfigs["black-pearl"];
  const alternateGuideIcon = guide.id === "black-pearl" ? michelinGuideIcon : blackPearlLogoIcon;
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

  useEffect(() => {
    if (!restaurants.length) return;
    if (restaurants.some((restaurant) => restaurant.city === filters.city)) return;
    const nextCity = activeCityOptions[0]?.value;
    if (nextCity) {
      setFilters((current) => ({ ...current, city: nextCity }));
      setSelectedId(null);
    }
  }, [activeCityOptions, filters.city, restaurants]);

  const handleSelect = useCallback((restaurantId: string) => {
    setSelectedId((current) => (current === restaurantId ? null : restaurantId));
  }, []);

  const handleClearSelect = useCallback(() => {
    setSelectedId(null);
  }, []);

  const updateCost = useCallback((costBands: CostBand[]) => {
    setFilters((current) => ({
      ...current,
      costBands: costBands.filter((costBand) => costBand !== "all"),
    }));
    setSelectedId(null);
  }, []);

  const updateCity = useCallback((city: CityCode) => {
    setFilters((current) => ({ ...current, city }));
    setSelectedId(null);
  }, []);

  const updateLevel = useCallback((levels: Array<MichelinLevel | "all">) => {
    setFilters((current) => ({
      ...current,
      levels: levels.filter((level): level is MichelinLevel => level !== "all"),
    }));
    setSelectedId(null);
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
            onSelect={handleSelect}
            restaurants={filteredRestaurants}
            selectedId={selectedId}
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
                  searchText: `${option.label} ${option.cityName} ${option.province} ${option.country}`,
                }))}
                searchable
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

        <section className="list-section">
          <RestaurantList
            onSelect={handleSelect}
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
      label: `${first.cityName} · ${first.province} · ${first.country}`,
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
