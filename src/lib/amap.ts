type AMapLoaderOptions = {
  key: string;
  securityCode?: string;
  timeoutMs?: number;
};

type RuntimeAmapConfig = {
  key?: string;
  securityCode?: string;
};

export type AMapLngLat = {
  getLng?: () => number;
  getLat?: () => number;
  lng?: number;
  lat?: number;
};

export type AMapMarker = {
  getContent?: () => HTMLElement | string;
  on: (eventName: string, handler: () => void) => void;
  setTop?: (isTop: boolean) => void;
  setzIndex?: (zIndex: number) => void;
};

export type AMapMap = {
  add: (overlays: AMapMarker | AMapMarker[]) => void;
  clearMap: () => void;
  destroy: () => void;
  getZoom?: () => number;
  off?: (eventName: string, handler: () => void) => void;
  on: (eventName: string, handler: () => void) => void;
  setCenter: (center: [number, number]) => void;
  setFeatures?: (features: string[]) => void;
  setFitView: (
    overlays?: AMapMarker[],
    immediately?: boolean,
    avoid?: [number, number, number, number],
    maxZoom?: number,
  ) => void;
  setMapStyle?: (style: string) => void;
  setZoom?: (zoom: number, immediately?: boolean, duration?: number) => void;
  setZoomAndCenter?: (
    zoom: number,
    center: [number, number],
    immediately?: boolean,
    duration?: number,
  ) => void;
};

export type AMapPlaceSearch = {
  search: (
    keyword: string,
    callback: (
      status: "complete" | "error" | "no_data",
      result:
        | {
            poiList?: {
              pois?: Array<{
                location?: AMapLngLat;
              }>;
            };
          }
        | string,
    ) => void,
  ) => void;
};

type AMapNamespace = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
  Pixel: new (x: number, y: number) => unknown;
  PlaceSearch?: new (options: Record<string, unknown>) => AMapPlaceSearch;
  plugin: (plugins: string[], callback: () => void) => void;
};

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: {
      securityJsCode?: string;
    };
  }
}

let loaderPromise: Promise<AMapNamespace> | null = null;
let loaderKey: string | null = null;
let configPromise: Promise<RuntimeAmapConfig> | null = null;

export function getAmapConfig() {
  configPromise ??= resolveAmapConfig();
  return configPromise;
}

async function resolveAmapConfig(): Promise<RuntimeAmapConfig> {
  const runtimeConfig = await readRuntimeAmapConfig();

  return {
    key: runtimeConfig.key ?? (import.meta.env.VITE_AMAP_KEY as string | undefined),
    securityCode:
      runtimeConfig.securityCode ??
      (import.meta.env.VITE_AMAP_SECURITY_CODE as string | undefined),
  };
}

async function readRuntimeAmapConfig(): Promise<RuntimeAmapConfig> {
  try {
    const response = await fetch(new URL("amap-config.json", getAppBaseUrl()), {
      cache: "no-store",
    });

    if (!response.ok) return {};

    const config = (await response.json()) as Partial<RuntimeAmapConfig>;

    return {
      key: typeof config.key === "string" ? config.key.trim() : undefined,
      securityCode:
        typeof config.securityCode === "string" ? config.securityCode.trim() : undefined,
    };
  } catch {
    return {};
  }
}

function getAppBaseUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin);
}

export function loadAmap({ key, securityCode, timeoutMs = 15000 }: AMapLoaderOptions) {
  const activeKey = key.trim();
  if (!activeKey) {
    return Promise.reject(new Error("AMap JSAPI key is empty"));
  }

  if (securityCode) {
    window._AMapSecurityConfig = {
      securityJsCode: securityCode,
    };
  }

  if (window.AMap) {
    return Promise.resolve(window.AMap);
  }

  if (loaderPromise && loaderKey === activeKey) {
    return loaderPromise;
  }

  loaderKey = activeKey;
  loaderPromise = new Promise<AMapNamespace>((resolve, reject) => {
    document
      .querySelectorAll<HTMLScriptElement>('script[data-amap-jsapi="true"]')
      .forEach((script) => script.remove());

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: activeKey,
      v: "2.0",
    });
    let timeoutId = 0;

    const resetLoader = () => {
      loaderPromise = null;
      loaderKey = null;
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.onload = null;
      script.onerror = null;
    };

    script.dataset.amapJsapi = "true";
    script.dataset.amapKey = activeKey;
    script.fetchPriority = "high";
    script.src = `https://webapi.amap.com/maps?${params.toString()}`;
    script.async = true;
    script.onload = () => {
      cleanup();
      if (!window.AMap) {
        resetLoader();
        reject(new Error("AMap JSAPI did not initialize"));
        return;
      }

      resolve(window.AMap);
    };
    script.onerror = () => {
      cleanup();
      resetLoader();
      reject(new Error("AMap JSAPI failed to load"));
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      script.remove();
      resetLoader();
      reject(new Error("AMap JSAPI timed out"));
    }, timeoutMs);

    document.head.appendChild(script);
  });

  return loaderPromise;
}

export function toLngLatArray(location: AMapLngLat): [number, number] | null {
  const lng = location.getLng?.() ?? location.lng;
  const lat = location.getLat?.() ?? location.lat;

  if (typeof lng !== "number" || typeof lat !== "number") {
    return null;
  }

  return [lng, lat];
}
