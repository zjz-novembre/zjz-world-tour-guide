import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";

export type FilterOption<T extends string> = {
  value: T;
  label: string;
  searchText?: string;
  marker?: ReactNode;
};

type FilterControlProps<T extends string> = {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  iconSrc?: string;
  label: string;
  value?: T;
  values?: T[];
  options: FilterOption<T>[];
  multiple?: boolean;
  searchable?: boolean;
  onChange?: (value: T) => void;
  onValuesChange?: (values: T[]) => void;
};

export function FilterControl<T extends string>({
  icon: Icon,
  iconSrc,
  label,
  value,
  values,
  options,
  multiple = false,
  searchable = false,
  onChange,
  onValuesChange,
}: FilterControlProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedValues = useMemo(
    () => (multiple ? values ?? [] : value ? [value] : []),
    [multiple, value, values],
  );
  const selected = options.filter(
    (option) => option.value !== "all" && selectedValues.includes(option.value),
  );
  const allOption = options.find((option) => option.value === "all");
  const displayValue = getDisplayValue(selected, allOption);
  const filteredOptions = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase();
    if (!trimmed) return options;

    return options.filter((option) =>
      (option.searchText ?? option.label).toLocaleLowerCase().includes(trimmed),
    );
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
      setQuery("");
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !searchable) return;

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, searchable]);

  const toggleOption = (nextValue: T) => {
    if (!multiple) {
      onChange?.(nextValue);
      setIsOpen(false);
      setQuery("");
      return;
    }

    if (nextValue === "all") {
      onValuesChange?.([]);
      return;
    }

    const exists = selectedValues.includes(nextValue);
    onValuesChange?.(
      exists
        ? selectedValues.filter((current) => current !== nextValue)
        : [...selectedValues, nextValue],
    );
  };

  return (
    <div
      className={`filter-control ${isOpen ? "filter-control--open" : ""}`}
      ref={rootRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="filter-control__button"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        {iconSrc ? (
          <img
            alt=""
            aria-hidden="true"
            className="filter-control__icon filter-control__image"
            src={iconSrc}
          />
        ) : Icon ? (
          <Icon aria-hidden="true" className="filter-control__icon" />
        ) : null}
        <span className="filter-control__copy">
          <span className="filter-control__label">{label}</span>
          <span className="filter-control__value">{displayValue}</span>
        </span>
        <ChevronDownIcon className="filter-control__chevron" />
      </button>

      {isOpen && (
        <div className="filter-control__popover">
          {searchable && (
            <input
              ref={inputRef}
              aria-label={`${label}搜索`}
              className="filter-control__search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <div className="filter-control__options" role="listbox" aria-label={label}>
            {filteredOptions.map((option) => {
              const isAll = option.value === "all";
              const isSelected = isAll
                ? selectedValues.length === 0
                : selectedValues.includes(option.value);

              return (
                <button
                  key={option.value}
                  aria-selected={isSelected}
                  className={`filter-control__option ${
                    isSelected ? "filter-control__option--selected" : ""
                  }`}
                  role="option"
                  type="button"
                  onClick={() => toggleOption(option.value)}
                >
                  <span className="filter-control__option-copy">
                    {option.marker}
                    <span className="filter-control__option-label">{option.label}</span>
                  </span>
                  {isSelected && <CheckIcon className="filter-control__check" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function getDisplayValue<T extends string>(
  selected: FilterOption<T>[],
  allOption: FilterOption<T> | undefined,
) {
  if (!selected.length) return allOption?.label ?? "不限";
  if (selected.length <= 2) return selected.map((option) => option.label).join("、");
  return `${selected[0].label} +${selected.length - 1}`;
}
