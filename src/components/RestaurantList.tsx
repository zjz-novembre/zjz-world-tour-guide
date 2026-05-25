import { useEffect, useRef } from "react";
import { ExternalLinkIcon, MapPinIcon } from "./icons";
import { LevelMark } from "./LevelMark";
import { formatCost } from "../lib/format";
import { restaurantExternalLink } from "../lib/externalLinks";
import type { GuideConfig, Restaurant } from "../types";

type RestaurantListProps = {
  restaurants: Restaurant[];
  selectedId: string | null;
  onSelect: (restaurantId: string) => void;
  guide: GuideConfig;
};

function initials(name: string) {
  return name.replace(/[（(].*?[)）]/g, "").slice(0, 2);
}

function dishesLabel(restaurant: Restaurant) {
  return restaurant.topDishes.length ? restaurant.topDishes.join(" / ") : restaurant.cuisine;
}

function RestaurantThumb({
  restaurant,
  className,
}: {
  restaurant: Restaurant;
  className: string;
}) {
  return (
    <span className={className} aria-hidden="true">
      {restaurant.coverImageUrl ? (
        <img
          alt=""
          decoding="async"
          fetchPriority="low"
          loading="lazy"
          src={restaurant.coverImageUrl}
        />
      ) : (
        initials(restaurant.name)
      )}
    </span>
  );
}

function RestaurantExternalLink({ restaurant }: { restaurant: Restaurant }) {
  const link = restaurantExternalLink(restaurant);
  return (
    <a
      aria-label={`${restaurant.name} 链接`}
      href={link.href}
      onClick={(event) => event.stopPropagation()}
      rel={link.rel}
      target={link.target}
    >
      <ExternalLinkIcon />
    </a>
  );
}

export function RestaurantList({
  restaurants,
  selectedId,
  onSelect,
  guide,
}: RestaurantListProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedId || restaurants[0]?.id !== selectedId) return;
    if (!bodyRef.current) return;
    bodyRef.current.scrollTop = 0;
  }, [restaurants, selectedId]);

  return (
    <div className="restaurant-list" role="table" aria-label="餐厅列表">
      <div className="restaurant-list__head" role="row">
        <span role="columnheader">餐厅</span>
        <span role="columnheader">人均</span>
        <span role="columnheader">{guide.levelColumnLabel}</span>
        <span role="columnheader">招牌</span>
        <span role="columnheader" aria-label="定位" />
      </div>

      <div ref={bodyRef} className="restaurant-list__body">
        {restaurants.map((restaurant) => {
          const cost = formatCost(restaurant.costPerPersonCny, restaurant.michelinPrice);
          const dishes = dishesLabel(restaurant);

          return (
            <button
              key={restaurant.id}
              className={
                restaurant.id === selectedId
                  ? "restaurant-row restaurant-row--active"
                  : "restaurant-row"
              }
              role="row"
              type="button"
              onClick={() => onSelect(restaurant.id)}
            >
              <span className="restaurant-row__name-cell" role="cell">
                <RestaurantThumb restaurant={restaurant} className="restaurant-row__thumb" />
                <span className="restaurant-row__identity">
                  <span className="restaurant-row__name">{restaurant.name}</span>
                  <span className="restaurant-row__meta">
                    <MapPinIcon />
                    {restaurant.district}
                  </span>
                </span>
              </span>
              <span className="restaurant-row__cost" role="cell">
                {cost}
              </span>
              <span className={`restaurant-row__level level-${restaurant.level}`} role="cell">
                <LevelMark guide={guide} level={restaurant.level} />
              </span>
              <span className="restaurant-row__dishes" role="cell">
                {dishes}
              </span>
              <span className="restaurant-row__link" role="cell">
                <RestaurantExternalLink restaurant={restaurant} />
              </span>

              <span className="restaurant-row__mobile-card">
                <RestaurantThumb restaurant={restaurant} className="restaurant-row__mobile-thumb" />
                <span className="restaurant-row__mobile-body">
                  <span className="restaurant-row__mobile-line">
                    <span className="restaurant-row__mobile-name">{restaurant.name}</span>
                    <span className="restaurant-row__mobile-cost">{cost}</span>
                    <span className={`restaurant-row__mobile-level level-${restaurant.level}`}>
                      <LevelMark guide={guide} level={restaurant.level} />
                    </span>
                    <span className="restaurant-row__mobile-link">
                      <RestaurantExternalLink restaurant={restaurant} />
                    </span>
                  </span>
                  <span className="restaurant-row__mobile-dishes">{dishes}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
