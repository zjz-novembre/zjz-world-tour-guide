import type { GuideConfig, MichelinLevel } from "../types";
import { formatLevel } from "../lib/format";

type LevelMarkProps = {
  guide: GuideConfig;
  level: MichelinLevel;
  className?: string;
};

const diamondCounts: Record<MichelinLevel, number> = {
  "three-stars": 3,
  "two-stars": 2,
  "one-star": 1,
  "bib-gourmand": 1,
  selected: 1,
};

export function LevelMark({ guide, level, className = "" }: LevelMarkProps) {
  const label = formatLevel(level, guide.levelLabels);

  if (guide.id !== "black-pearl") {
    return <span className={className}>{label}</span>;
  }

  const count = diamondCounts[level];

  return (
    <span
      aria-label={label}
      className={`level-mark level-mark--diamonds level-mark--diamonds-${count} ${className}`}
      title={label}
    >
      {Array.from({ length: count }, (_, index) => (
        <img
          alt=""
          aria-hidden="true"
          className="level-mark__diamond"
          decoding="async"
          key={index}
          src={guide.primaryPinIcon}
        />
      ))}
    </span>
  );
}
