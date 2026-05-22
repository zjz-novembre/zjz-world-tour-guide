import { levelRank } from "../data/options";
import type { CostBand, MichelinLevel, Restaurant, RestaurantFilters } from "../types";

export function getCostBand(cost: number): Exclude<CostBand, "all"> {
  if (cost < 50) return "under-50";
  if (cost < 100) return "50-100";
  if (cost < 200) return "100-200";
  if (cost < 500) return "200-500";
  return "500-plus";
}

export function filterRestaurants(
  restaurants: Restaurant[],
  filters: RestaurantFilters,
  rank: Record<MichelinLevel, number> = levelRank,
) {
  const activeCostBands = filters.costBands.filter((costBand) => costBand !== "all");
  const activeLevels = filters.levels;

  return restaurants
    .filter((restaurant) => restaurant.city === filters.city)
    .filter((restaurant) => {
      if (!activeCostBands.length) return true;
      if (!restaurant.costPerPersonCny) return false;
      return activeCostBands.includes(getCostBand(restaurant.costPerPersonCny));
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
