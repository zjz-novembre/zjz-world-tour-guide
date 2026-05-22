import { levelLabels } from "../data/options";
import type { MichelinLevel } from "../types";

export function formatCost(cost?: number, michelinPrice?: string) {
  if (!cost) return michelinPrice || "—";
  return `¥${cost}`;
}

export function formatLevel(
  level: MichelinLevel,
  labels: Record<MichelinLevel, string> = levelLabels,
) {
  return labels[level];
}
