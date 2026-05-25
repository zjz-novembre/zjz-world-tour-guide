const CACHE_NAME = "lite-michelin-v20260525-v111-map-style";
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const scoped = (path) => `${SCOPE_PATH}${path}`;
const APP_SHELL = [
  scoped("/"),
  scoped("/index.html"),
  scoped("/api/restaurants"),
  scoped("/api/black-pearl/restaurants"),
  scoped("/amap-config.json"),
  scoped("/favicon.svg"),
  scoped("/manifest.webmanifest"),
  scoped("/fonts/openai-sans-v2-regular.woff2"),
  scoped("/fonts/openai-sans-v2-medium.woff2"),
  scoped("/fonts/openai-sans-v2-semibold.woff2"),
  scoped("/fonts/openai-sans-v2-bold.woff2"),
  scoped("/michelin-guide.svg"),
  scoped("/michelin-star-white.svg"),
  scoped("/michelin-bib-gourmand-white.svg?v=20260430-3"),
  scoped("/restaurant-selected-white.svg"),
  scoped("/black-pearl-official-diamond.png"),
  scoped("/black-pearl-diamond-official-52.png"),
  scoped("/black-pearl-logo-official.png"),
  scoped("/black-pearl-switch-logo.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, scoped("/index.html")));
    return;
  }

  if (
    url.pathname === scoped("/api/restaurants") ||
    url.pathname === scoped("/api/black-pearl/restaurants") ||
    url.pathname.startsWith(scoped("/assets/")) ||
    url.pathname.startsWith(scoped("/fonts/"))
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return fallbackUrl ? await cache.match(fallbackUrl) : new Response("", { status: 504 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetched = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached ?? (await fetched) ?? new Response("", { status: 504 });
}
