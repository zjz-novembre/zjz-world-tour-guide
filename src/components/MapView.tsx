import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAmapConfig,
  loadAmap,
  toLngLatArray,
  type AMapMap,
  type AMapMarker,
  type AMapPlaceSearch,
} from "../lib/amap";
import type { CityOption, GuideConfig, Restaurant, UserLocation } from "../types";
import { formatCost, formatLevel } from "../lib/format";

type MapViewProps = {
  city: CityOption;
  restaurants: Restaurant[];
  selectedId: string | null;
  selectedMode: "small" | "detail" | null;
  onClearSelection: () => void;
  onSelect: (restaurantId: string) => void;
  userLocation: UserLocation | null;
  guide: GuideConfig;
};

type ResolvedPoint = {
  restaurant: Restaurant;
  position: [number, number];
};

type MapStatus = "missing-key" | "loading" | "ready" | "failed" | "offline";
type ZoomBand = "pin" | "tag" | "detail";
type MapConfig = {
  key?: string;
  securityCode?: string;
};
type MapFocus = {
  x: number;
  y: number;
  scaleWidth: number;
};
const AMAP_STYLE = "amap://styles/whitesmoke";
const AMAP_FEATURES = ["bg", "road"];
const DESKTOP_MAP_FOCUS_RATIO = 0.3;
const DESKTOP_CITY_SCALE_RATIO = 0.6;
const MOBILE_CITY_SCALE_RATIO = 0.92;
const MOBILE_MAX_WIDTH = 760;
const MOBILE_LANDSCAPE_MAX_WIDTH = 960;
const MOBILE_LANDSCAPE_MAX_HEIGHT = 520;
const SHANGHAI_INNER_RING_SPAN_KM = 14;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const MAP_TILE_SIZE = 256;
const RESTAURANT_MARKER_Z_INDEX = 30;
const ACTIVE_RESTAURANT_MARKER_Z_INDEX = 10000;
const PUBLIC_ASSET_BASE = new URL(import.meta.env.BASE_URL, window.location.origin);
const BIB_PIN_ICON = `${new URL("michelin-bib-gourmand-white.svg", PUBLIC_ASSET_BASE).pathname}?v=20260430-3`;
const SELECTED_PIN_ICON = new URL("restaurant-selected-white.svg", PUBLIC_ASSET_BASE).pathname;

export function MapView({
  city,
  restaurants,
  selectedId,
  selectedMode,
  onClearSelection,
  onSelect,
  userLocation,
  guide,
}: MapViewProps) {
  const surfaceNode = useRef<HTMLDivElement | null>(null);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const map = useRef<AMapMap | null>(null);
  const suppressNextMapClear = useRef(false);
  const cityRef = useRef(city);
  const markers = useRef<Map<string, AMapMarker>>(new Map());
  const markerElements = useRef<Map<string, HTMLElement>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [mapConfig, setMapConfig] = useState<MapConfig | null>(null);
  const amapKey = mapConfig?.key?.trim();
  const amapSecurityCode = mapConfig?.securityCode?.trim();
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [zoomBand, setZoomBand] = useState<ZoomBand>("pin");

  const restaurantKey = useMemo(
    () => restaurants.map((restaurant) => restaurant.id).join("|"),
    [restaurants],
  );

  useEffect(() => {
    cityRef.current = city;
  }, [city]);

  useEffect(() => {
    let cancelled = false;

    getAmapConfig().then((config) => {
      if (!cancelled) {
        setMapConfig(config);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapConfig) {
      setMapReady(false);
      setMapStatus("loading");
      return;
    }

    if (!navigator.onLine) {
      setMapReady(false);
      setMapStatus("offline");
      return;
    }

    if (!amapKey || !mapNode.current) {
      setMapReady(false);
      setMapStatus("missing-key");
      return;
    }

    let cancelled = false;
    let readinessFrame = 0;
    let readinessTimeout = 0;
    setMapStatus("loading");
    setZoomBand("pin");

    const markReady = () => {
      if (cancelled) return;
      window.cancelAnimationFrame(readinessFrame);
      window.clearTimeout(readinessTimeout);
      map.current?.setFeatures?.(AMAP_FEATURES);
      map.current?.setMapStyle?.(AMAP_STYLE);
      setZoomBand(getZoomBand(map.current?.getZoom?.() ?? 12));
      setMapStatus("ready");
    };

    const watchLiveAmapDom = () => {
      if (cancelled) return;
      if (mapNode.current && hasLiveAmapDom(mapNode.current)) {
        markReady();
        return;
      }

      readinessFrame = window.requestAnimationFrame(watchLiveAmapDom);
    };

    loadAmap({ key: amapKey, securityCode: amapSecurityCode })
      .then((AMap) => {
        if (cancelled || !mapNode.current) return;

        const initialCity = cityRef.current;
        const initialZoom = getVisibleCityZoom(initialCity, mapNode.current);
        const initialCenter = getVisibleCityCenter(initialCity, mapNode.current, initialZoom);
        const nextMap = new AMap.Map(mapNode.current, {
          center: initialCenter,
          features: AMAP_FEATURES,
          isHotspot: false,
          mapStyle: AMAP_STYLE,
          pitch: 0,
          resizeEnable: true,
          showLabel: true,
          showIndoorMap: false,
          viewMode: "2D",
          zoom: initialZoom,
        });
        map.current = nextMap;
        nextMap.setFeatures?.(AMAP_FEATURES);
        nextMap.setMapStyle?.(AMAP_STYLE);
        setMapReady(true);
        setZoomBand(getZoomBand(nextMap.getZoom?.() ?? 12));

        const syncZoomBand = () => setZoomBand(getZoomBand(nextMap.getZoom?.() ?? 12));
        nextMap.on("zoomchange", syncZoomBand);
        nextMap.on("zoomend", syncZoomBand);
        nextMap.on("complete", markReady);
        readinessFrame = window.requestAnimationFrame(watchLiveAmapDom);
        readinessTimeout = window.setTimeout(() => {
          if (cancelled) return;
          setMapReady(false);
          setMapStatus("failed");
        }, 15000);
      })
      .catch(() => {
        setMapReady(false);
        setMapStatus(navigator.onLine ? "failed" : "offline");
      });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(readinessFrame);
      window.clearTimeout(readinessTimeout);
      markers.current.clear();
      markerElements.current.clear();
      map.current?.destroy();
      map.current = null;
      setMapReady(false);
    };
  }, [amapKey, amapSecurityCode, mapConfig]);

  useEffect(() => {
    if (!amapKey || !map.current || !window.AMap || !mapReady) return;

    let cancelled = false;
    const AMap = window.AMap;
    const activeMap = map.current;

    activeMap.clearMap();
    markers.current.clear();
    markerElements.current.clear();
    applyCityView(activeMap, city, mapNode.current);

    resolveRestaurantPoints(AMap, city, restaurants).then((points) => {
      if (cancelled || !map.current || !window.AMap) return;

      const cityAnchor = createCityAnchorMarker(city);
      const nextMarkers = points.map(({ restaurant, position }) => {
        const selectRestaurant = () => {
          suppressNextMapClear.current = true;
          window.setTimeout(() => {
            suppressNextMapClear.current = false;
          }, 0);
          onSelect(restaurant.id);
        };
        const content = createMarkerContent(restaurant, selectRestaurant, guide);
        const marker = new window.AMap!.Marker({
          anchor: "bottom-center",
          content,
          offset: new window.AMap!.Pixel(0, 0),
          position,
          title: restaurant.name,
          zIndex: RESTAURANT_MARKER_Z_INDEX,
        });

        markers.current.set(restaurant.id, marker);
        markerElements.current.set(restaurant.id, content);

        return marker;
      });
      const userMarker = userLocation ? createUserLocationMarker(userLocation) : null;

      map.current.add([cityAnchor, ...nextMarkers, ...(userMarker ? [userMarker] : [])]);
      applyCityView(map.current, city, mapNode.current);
      setZoomBand(getZoomBand(map.current.getZoom?.() ?? getVisibleCityZoom(city, mapNode.current)));
    });

    return () => {
      cancelled = true;
    };
  }, [amapKey, city, mapReady, onSelect, restaurantKey, restaurants, userLocation]);

  useEffect(() => {
    const element = surfaceNode.current;
    if (!element) return;

    const clearOnMapClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".map-marker, .offline-city-map__marker")) {
        return;
      }

      onClearSelection();
    };

    element.addEventListener("click", clearOnMapClick);

    return () => {
      element.removeEventListener("click", clearOnMapClick);
    };
  }, [onClearSelection]);

  useEffect(() => {
    if (!map.current || !mapReady) return;

    const clearOnAmapClick = () => {
      if (suppressNextMapClear.current) {
        suppressNextMapClear.current = false;
        return;
      }

      onClearSelection();
    };

    map.current.on("click", clearOnAmapClick);

    return () => {
      map.current?.off?.("click", clearOnAmapClick);
    };
  }, [mapReady, onClearSelection]);

  useEffect(() => {
    if (!map.current || !mapReady) return;

    let resizeFrame = 0;
    const syncCityView = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        if (!map.current) return;
        applyCityView(map.current, city, mapNode.current);
        setZoomBand(getZoomBand(map.current.getZoom?.() ?? getVisibleCityZoom(city, mapNode.current)));
      });
    };

    window.addEventListener("resize", syncCityView);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", syncCityView);
    };
  }, [city, mapReady]);

  useEffect(() => {
    markers.current.forEach((item) => {
      item.setTop?.(false);
      item.setzIndex?.(RESTAURANT_MARKER_Z_INDEX);
    });
    markerElements.current.forEach((element, restaurantId) => {
      const isSelected = restaurantId === selectedId;
      element.classList.toggle("map-marker--active", isSelected && selectedMode === "detail");
      element.classList.toggle("map-marker--selected-small", isSelected && selectedMode === "small");
    });

    if (!selectedId || !map.current) return;

    const marker = markers.current.get(selectedId);
    if (!marker) return;

    marker.setTop?.(true);
    marker.setzIndex?.(ACTIVE_RESTAURANT_MARKER_Z_INDEX);
  }, [selectedId, selectedMode]);

  return (
    <div
      ref={surfaceNode}
      className={`amap-surface amap-surface--${mapStatus} amap-surface--zoom-${zoomBand}`}
      aria-label="高德地图"
      data-amap-status={mapStatus}
      data-map-city={city.value}
      data-amap-zoom-band={zoomBand}
      data-map-scale-km={SHANGHAI_INNER_RING_SPAN_KM}
      data-cached-map={mapStatus === "ready" ? "hidden" : "visible"}
    >
      <div ref={mapNode} className="amap-live-layer" aria-hidden={mapStatus !== "ready"} />
      {mapStatus !== "ready" && (
        <OfflineCityMap
          city={city}
          guide={guide}
          restaurants={restaurants}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function hasLiveAmapDom(element: HTMLElement) {
  return Boolean(
    element.querySelector(
      ".amap-maps, .amap-layer, .amap-layers, .amap-logo, .amap-copyright, canvas",
    ),
  );
}

function getZoomBand(zoom: number): ZoomBand {
  if (zoom >= 17.5) return "detail";
  if (zoom >= 14.5) return "tag";
  return "pin";
}

function applyCityView(activeMap: AMapMap, city: CityOption, element: HTMLElement | null) {
  const zoom = getVisibleCityZoom(city, element);
  const center = getVisibleCityCenter(city, element, zoom);

  if (activeMap.setZoomAndCenter) {
    activeMap.setZoomAndCenter(zoom, center, true);
    return;
  }

  activeMap.setCenter(center);
  activeMap.setZoom?.(zoom, true);
}

function getVisibleCityCenter(city: CityOption, element: HTMLElement | null, zoom: number): [number, number] {
  const width = element?.clientWidth ?? window.innerWidth;
  const height = element?.clientHeight ?? window.innerHeight;
  const focus = getMapFocus(element, width, height);
  const horizontalPixels = width / 2 - focus.x;
  const verticalPixels = height / 2 - focus.y;
  const lngShift = getLongitudeShiftForPixels(horizontalPixels, city.center[1], zoom);
  const latShift = getLatitudeShiftForPixels(verticalPixels, city.center[1], zoom);

  return [city.center[0] + lngShift, city.center[1] + latShift];
}

function getVisibleCityZoom(city: CityOption, element: HTMLElement | null) {
  const width = element?.clientWidth ?? window.innerWidth;
  const height = element?.clientHeight ?? window.innerHeight;
  const { scaleWidth } = getMapFocus(element, width, height);
  const metersPerPixel = (SHANGHAI_INNER_RING_SPAN_KM * 1000) / scaleWidth;
  const latitudeFactor = Math.max(Math.cos((city.center[1] * Math.PI) / 180), 0.2);
  const worldPixels = (EARTH_CIRCUMFERENCE_METERS * latitudeFactor) / metersPerPixel;

  return Math.log2(worldPixels / MAP_TILE_SIZE);
}

function getMapFocus(element: HTMLElement | null, width: number, height: number): MapFocus {
  const mapRect = element?.getBoundingClientRect();
  const stageRect = document.querySelector(".content-shell")?.getBoundingClientRect();
  const chromeRect = document.querySelector(".chrome-layer")?.getBoundingClientRect();
  const listRect = document.querySelector(".list-section")?.getBoundingClientRect();
  const stageLeft = stageRect?.left ?? mapRect?.left ?? 0;
  const stageTop = stageRect?.top ?? mapRect?.top ?? 0;
  const stageRight = stageRect?.right ?? stageLeft + width;
  const stageBottom = stageRect?.bottom ?? stageTop + height;
  const stageWidth = stageRight - stageLeft;
  const isLandscapeMobile = width <= MOBILE_LANDSCAPE_MAX_WIDTH && height <= MOBILE_LANDSCAPE_MAX_HEIGHT;
  const isPortraitMobile = width <= MOBILE_MAX_WIDTH;
  let visibleLeft = stageLeft;
  let visibleTop = stageTop;
  let visibleRight = stageRight;
  let visibleBottom = stageBottom;

  if (chromeRect && (isPortraitMobile || isLandscapeMobile)) {
    visibleTop = Math.max(visibleTop, chromeRect.bottom);
  }

  if (listRect) {
    const listIsRightRail =
      listRect.width < stageWidth * 0.7 && listRect.left > stageLeft + stageWidth * 0.35;

    if (listIsRightRail) {
      visibleRight = Math.min(visibleRight, listRect.left);
    } else if (isPortraitMobile) {
      visibleBottom = Math.min(visibleBottom, listRect.top);
    }
  }

  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
    return {
      x: isPortraitMobile ? width / 2 : width * DESKTOP_MAP_FOCUS_RATIO,
      y: height / 2,
      scaleWidth: width * (isPortraitMobile ? MOBILE_CITY_SCALE_RATIO : DESKTOP_CITY_SCALE_RATIO),
    };
  }

  const mapLeft = mapRect?.left ?? 0;
  const mapTop = mapRect?.top ?? 0;
  const visibleWidth = visibleRight - visibleLeft;
  const scaleWidth = visibleWidth * (isPortraitMobile ? MOBILE_CITY_SCALE_RATIO : 1);

  return {
    x: (visibleLeft + visibleRight) / 2 - mapLeft,
    y: (visibleTop + visibleBottom) / 2 - mapTop,
    scaleWidth,
  };
}

function getLongitudeShiftForPixels(pixels: number, latitude: number, zoom: number) {
  const tileSize = 256;
  const worldPixels = tileSize * 2 ** zoom;
  const latitudeFactor = Math.max(Math.cos((latitude * Math.PI) / 180), 0.2);

  return (pixels * 360) / (worldPixels * latitudeFactor);
}

function getLatitudeShiftForPixels(pixels: number, latitude: number, zoom: number) {
  const tileSize = 256;
  const worldPixels = tileSize * 2 ** zoom;
  const latitudeFactor = Math.max(Math.cos((latitude * Math.PI) / 180), 0.2);

  return (-pixels * 360 * latitudeFactor) / worldPixels;
}

function createCityAnchorMarker(city: CityOption): AMapMarker {
  const anchor = document.createElement("span");
  anchor.className = "map-city-anchor";
  anchor.dataset.city = city.value;

  return new window.AMap!.Marker({
    anchor: "center",
    content: anchor,
    position: city.center,
    title: city.cityName,
  });
}

function createUserLocationMarker(location: UserLocation): AMapMarker {
  const marker = document.createElement("span");
  marker.className = "map-user-location";
  marker.setAttribute("aria-label", "当前位置方向");
  marker.style.setProperty("--user-heading", `${normalizeHeading(location.heading)}deg`);

  const arrow = document.createElement("span");
  arrow.className = "map-user-location__arrow";
  marker.appendChild(arrow);

  return new window.AMap!.Marker({
    anchor: "center",
    content: marker,
    position: location.position,
    title: "当前位置",
    zIndex: 999,
  });
}

function normalizeHeading(heading: number | null) {
  if (heading === null || !Number.isFinite(heading)) return 0;

  return ((heading % 360) + 360) % 360;
}

function createMarkerContent(restaurant: Restaurant, onClick: () => void, guide: GuideConfig) {
  const marker = document.createElement("div");
  marker.className = `map-marker map-marker--${restaurant.level}`;
  marker.dataset.restaurantId = restaurant.id;
  marker.role = "button";
  marker.tabIndex = 0;
  marker.setAttribute("aria-label", restaurant.name);
  marker.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  marker.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  });

  const pin = document.createElement("span");
  pin.className = "map-marker__pin";

  pin.appendChild(createPinGlyph(restaurant.level, guide));

  const tag = document.createElement("span");
  tag.className = "map-marker__tag";

  if (restaurant.coverImageUrl) {
    const image = document.createElement("img");
    image.className = "map-marker__tag-image";
    image.alt = "";
    image.decoding = "async";
    image.loading = "lazy";
    image.src = restaurant.coverImageUrl;
    tag.appendChild(image);
  }

  const tagCopy = document.createElement("span");
  tagCopy.className = "map-marker__tag-copy";

  const tagName = document.createElement("span");
  tagName.className = "map-marker__tag-name";
  tagName.textContent = restaurant.name;
  tagCopy.appendChild(tagName);

  const tagMeta = document.createElement("span");
  tagMeta.className = "map-marker__tag-meta";
  const tagLevel = document.createElement("span");
  tagLevel.className = `map-marker__tag-level level-${restaurant.level}`;
  tagLevel.textContent = formatLevel(restaurant.level, guide.levelLabels);
  const tagSeparator = document.createElement("span");
  tagSeparator.className = "map-marker__tag-separator";
  tagSeparator.textContent = "·";
  const tagCost = document.createElement("span");
  tagCost.className = "map-marker__tag-cost";
  tagCost.textContent = formatCost(restaurant.costPerPersonCny, restaurant.michelinPrice);
  tagMeta.append(tagLevel, tagSeparator, tagCost);
  tagCopy.appendChild(tagMeta);

  const tagDishes = document.createElement("span");
  tagDishes.className = "map-marker__tag-dishes";
  tagDishes.textContent = restaurant.topDishes.length
    ? restaurant.topDishes.join(" / ")
    : restaurant.cuisine;
  tagCopy.appendChild(tagDishes);
  tag.appendChild(tagCopy);

  marker.append(pin, tag);

  return marker;
}

function createPinGlyph(level: Restaurant["level"], guide: GuideConfig) {
  if (level === "bib-gourmand") {
    return createPinImage(BIB_PIN_ICON, "map-marker__pin-icon--bib");
  }

  if (level !== "selected") {
    return createPinImage(guide.primaryPinIcon, guide.primaryPinClassName);
  }

  return createPinImage(SELECTED_PIN_ICON, "map-marker__pin-icon--selected");
}

function createPinImage(src: string, className: string) {
  const image = document.createElement("img");
  image.alt = "";
  image.ariaHidden = "true";
  image.className = `map-marker__pin-icon ${className}`;
  image.decoding = "async";
  image.loading = "eager";
  image.src = src;
  return image;
}

function OfflineCityMap({
  city,
  guide,
  restaurants,
  selectedId,
  onSelect,
}: {
  city: CityOption;
  guide: GuideConfig;
  restaurants: Restaurant[];
  selectedId: string | null;
  onSelect: (restaurantId: string) => void;
}) {
  return (
    <div className="offline-city-map" aria-hidden={false}>
      <span className="offline-city-map__water offline-city-map__water--one" aria-hidden="true" />
      <span className="offline-city-map__water offline-city-map__water--two" aria-hidden="true" />
      <span className="offline-city-map__park offline-city-map__park--one" aria-hidden="true" />
      <span className="offline-city-map__park offline-city-map__park--two" aria-hidden="true" />
      <span className="offline-city-map__road offline-city-map__road--one" aria-hidden="true" />
      <span className="offline-city-map__road offline-city-map__road--two" aria-hidden="true" />
      <span className="offline-city-map__road offline-city-map__road--three" aria-hidden="true" />
      <span className="offline-city-map__road offline-city-map__road--four" aria-hidden="true" />
      <span className="offline-city-map__road offline-city-map__road--five" aria-hidden="true" />
      <span className="offline-city-map__road offline-city-map__road--six" aria-hidden="true" />
      <span className="offline-city-map__road offline-city-map__road--seven" aria-hidden="true" />
      <span className="offline-city-map__road offline-city-map__road--eight" aria-hidden="true" />
      <span className="offline-city-map__axis offline-city-map__axis--one" />
      <span className="offline-city-map__axis offline-city-map__axis--two" />
      <span className="offline-city-map__axis offline-city-map__axis--three" />
      <span className="offline-city-map__ring" />
      <span className="offline-city-map__center">{city.cityName}</span>
      {restaurants
        .filter((restaurant) => restaurant.position)
        .map((restaurant) => {
          const [x, y] = getOfflinePoint(city, restaurant.position!);
          return (
            <button
              key={restaurant.id}
              className={`offline-city-map__marker offline-city-map__marker--${restaurant.level} ${
                restaurant.id === selectedId ? "offline-city-map__marker--active" : ""
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
              type="button"
              onClick={() => onSelect(restaurant.id)}
              aria-label={restaurant.name}
            >
              {createOfflinePinGlyph(restaurant.level, guide)}
            </button>
          );
        })}
    </div>
  );
}

function createOfflinePinGlyph(level: Restaurant["level"], guide: GuideConfig) {
  if (level === "bib-gourmand") {
    return <img alt="" aria-hidden="true" className="map-marker__pin-icon map-marker__pin-icon--bib" src={BIB_PIN_ICON} />;
  }

  if (level !== "selected") {
    return <img alt="" aria-hidden="true" className={`map-marker__pin-icon ${guide.primaryPinClassName}`} src={guide.primaryPinIcon} />;
  }

  return <img alt="" aria-hidden="true" className="map-marker__pin-icon map-marker__pin-icon--selected" src={SELECTED_PIN_ICON} />;
}

function getOfflinePoint(city: CityOption, position: [number, number]) {
  const [centerLng, centerLat] = city.center;
  const [lng, lat] = position;
  const x = clamp(30 + (lng - centerLng) * city.offlineScale, 6, 56);
  const y = clamp(50 - (lat - centerLat) * city.offlineScale, 10, 90);

  return [x, y];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function resolveRestaurantPoints(
  AMap: NonNullable<typeof window.AMap>,
  city: CityOption,
  restaurants: Restaurant[],
): Promise<ResolvedPoint[]> {
  const storedPoints = restaurants
    .filter((restaurant) => restaurant.position)
    .map((restaurant) => ({
      restaurant,
      position: restaurant.position!,
    }));
  const pendingRestaurants = restaurants.filter((restaurant) => !restaurant.position);

  if (pendingRestaurants.length === 0) {
    return storedPoints;
  }

  await new Promise<void>((resolve) => {
    AMap.plugin(["AMap.PlaceSearch"], resolve);
  });

  if (!AMap.PlaceSearch) return storedPoints;

  const search = new AMap.PlaceSearch({
    city: city.amapCity,
    citylimit: true,
    extensions: "base",
    pageIndex: 1,
    pageSize: 1,
  });

  const points = await Promise.all(
    pendingRestaurants.map(async (restaurant) => {
      const position = await searchAmapPlace(search, restaurant.poiQuery);

      if (!position) return null;

      return {
        restaurant,
        position,
      };
    }),
  );

  return storedPoints.concat(points.filter((point): point is ResolvedPoint => point !== null));
}

function searchAmapPlace(search: AMapPlaceSearch, query: string) {
  return new Promise<[number, number] | null>((resolve) => {
    search.search(query, (status, result) => {
      if (status !== "complete" || typeof result === "string") {
        resolve(null);
        return;
      }

      const location = result.poiList?.pois?.[0]?.location;
      resolve(location ? toLngLatArray(location) : null);
    });
  });
}
