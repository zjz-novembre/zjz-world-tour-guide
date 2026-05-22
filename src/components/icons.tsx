import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

export function AwardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.5 13.8 8l4.7.4-3.6 3.1 1.1 4.6-4-2.4-4 2.4 1.1-4.6-3.6-3.1 4.7-.4L12 3.5Z" />
      <path d="m9 15.5-1.2 5 4.2-2.3 4.2 2.3-1.2-5" />
    </IconBase>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 9 6 6 6-6" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 12.5 4.2 4.2L19 6.8" />
    </IconBase>
  );
}

export function DiamondIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3 20 10.5 12 21 4 10.5 12 3Z" />
      <path d="M4 10.5h16" />
      <path d="m8.6 10.5 3.4 10 3.4-10" />
      <path d="m8.6 10.5 1.7-7.5" />
      <path d="m15.4 10.5-1.7-7.5" />
    </IconBase>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 4h6v6" />
      <path d="m10 14 10-10" />
      <path d="M20 15v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
    </IconBase>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </IconBase>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 12 12 20 4 12V4h8l8 8Z" />
      <path d="M8 8h.01" />
    </IconBase>
  );
}
