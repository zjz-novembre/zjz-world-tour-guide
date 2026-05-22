import type { Restaurant } from "../types";

type RestaurantsApiResponse = {
  source: "sqlite";
  database: string;
  count: number;
  restaurants: Restaurant[];
};

export async function loadRestaurants() {
  return loadRestaurantsFrom("api/restaurants");
}

export async function loadRestaurantsFrom(apiPath: string) {
  const response = await fetch(new URL(apiPath, getAppBaseUrl()), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Restaurant database API failed: ${response.status}`);
  }

  const payload = (await response.json()) as RestaurantsApiResponse;
  if (payload.source !== "sqlite" || payload.count !== payload.restaurants.length) {
    throw new Error("Restaurant database API returned an invalid payload");
  }

  return payload.restaurants;
}

function getAppBaseUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin);
}
