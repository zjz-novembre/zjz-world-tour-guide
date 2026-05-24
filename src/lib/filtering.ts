import { levelRank } from "../data/options";
import type { CostBand, MichelinLevel, Restaurant, RestaurantFilters } from "../types";

export function getCostBand(cost: number): Exclude<CostBand, "all"> {
  if (cost < 50) return "under-50";
  if (cost < 100) return "50-100";
  if (cost < 200) return "100-200";
  if (cost < 500) return "200-500";
  return "500-plus";
}

export function matchesCostBand(cost: number, band: Exclude<CostBand, "all">) {
  switch (band) {
    case "under-50":
      return cost < 50;
    case "50-100":
      return cost >= 50 && cost < 100;
    case "100-200":
      return cost >= 100 && cost < 200;
    case "under-200":
      return cost < 200;
    case "200-500":
      return cost >= 200 && cost < 500;
    case "500-1000":
      return cost >= 500 && cost < 1000;
    case "500-plus":
      return cost >= 500;
    case "1000-plus":
      return cost >= 1000;
  }
}

export function filterRestaurants(
  restaurants: Restaurant[],
  filters: RestaurantFilters,
  rank: Record<MichelinLevel, number> = levelRank,
) {
  const activeCostBands = filters.costBands.filter(
    (costBand): costBand is Exclude<CostBand, "all"> => costBand !== "all",
  );
  const activeLevels = filters.levels;

  return restaurants
    .filter((restaurant) => restaurant.city === filters.city)
    .filter((restaurant) => {
      if (!activeCostBands.length) return true;
      if (!restaurant.costPerPersonCny) return false;
      return activeCostBands.some((costBand) => matchesCostBand(restaurant.costPerPersonCny!, costBand));
    })
    .filter((restaurant) => {
      if (!activeLevels.length) return true;
      return activeLevels.includes(restaurant.level);
    })
    .sort((left, right) => {
      const levelDelta = rank[left.level] - rank[right.level];
      if (levelDelta !== 0) return levelDelta;
      return (left.costPerPersonCny ?? Number.POSITIVE_INFINITY) - (right.costPerPersonCny ?? Number.POSITIVE_INFINITY);
    });
}

export function countByLevel(restaurants: Restaurant[]) {
  return restaurants.reduce<Record<string, number>>((acc, restaurant) => {
    acc[restaurant.level] = (acc[restaurant.level] ?? 0) + 1;
    return acc;
  }, {});
}
