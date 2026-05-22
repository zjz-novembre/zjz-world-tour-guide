import { levelLabels, levelOptions, levelRank } from "./options";
import type { GuideConfig, MichelinLevel } from "../types";

const assetBase = new URL(import.meta.env.BASE_URL, window.location.origin);

const blackPearlLabels: Record<MichelinLevel, string> = {
  "three-stars": "三钻",
  "two-stars": "二钻",
  "one-star": "一钻",
  "bib-gourmand": "一钻",
  selected: "一钻",
};

const blackPearlRank: Record<MichelinLevel, number> = {
  "three-stars": 0,
  "two-stars": 1,
  "one-star": 2,
  "bib-gourmand": 3,
  selected: 4,
};

export const guideConfigs: Record<string, GuideConfig> = {
  michelin: {
    id: "michelin",
    brand: "MICHELIN",
    documentTitle: "Lite Michelin",
    apiPath: "api/restaurants",
    defaultCity: "shanghai",
    levelFilterLabel: "星级",
    levelColumnLabel: "星级",
    levelOptions,
    levelLabels,
    levelRank,
    primaryPinIcon: new URL("michelin-star-white.svg", assetBase).pathname,
    primaryPinClassName: "map-marker__pin-icon--star",
  },
  "black-pearl": {
    id: "black-pearl",
    brand: "Black Pearl",
    documentTitle: "Black Pearl",
    apiPath: "api/black-pearl/restaurants",
    defaultCity: "shanghai",
    levelFilterLabel: "钻级",
    levelColumnLabel: "钻级",
    levelOptions: [
      { value: "all", label: "全榜" },
      { value: "three-stars", label: "三钻" },
      { value: "two-stars", label: "二钻" },
      { value: "one-star", label: "一钻" },
    ],
    levelLabels: blackPearlLabels,
    levelRank: blackPearlRank,
    primaryPinIcon: new URL("black-pearl-diamond-official-52.png", assetBase).pathname,
    primaryPinClassName: "map-marker__pin-icon--diamond",
  },
};

export function resolveGuideConfig(pathname: string) {
  return pathname.includes("black-pearl") ? guideConfigs["black-pearl"] : guideConfigs.michelin;
}
