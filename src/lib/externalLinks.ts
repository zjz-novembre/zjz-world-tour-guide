import type { Restaurant } from "../types";

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function restaurantExternalLink(restaurant: Restaurant) {
  const useAppLink = isMobileDevice() && restaurant.dianpingAppUrl;
  return {
    href: useAppLink ? restaurant.dianpingAppUrl : restaurant.mapsUrl,
    target: useAppLink ? undefined : "_blank",
    rel: useAppLink ? undefined : "noreferrer",
  };
}
