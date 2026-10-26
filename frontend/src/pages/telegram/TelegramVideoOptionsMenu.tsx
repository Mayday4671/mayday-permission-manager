import { useEffect, useRef } from "react";
import { Check } from "lucide-react";

interface Option {
  value: string;
  label: string;
  description?: string;
}

/** A player-local menu stays visible in native fullscreen and supports keyboard navigation. */
export function TelegramVideoOptionsMenu({
  label,
  text,
  options,
  value,
  open,
  onOpenChange,
  onChange,
}: {
  label: string;
  text: string;
  options: Option[];
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, onOpenChange]);
  return (
    <div
      ref={root}
      className="telegram-video-options"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          onOpenChange(false);
      }}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
          root.current
            ?.querySelector<HTMLButtonElement>(".telegram-video-control")
            ?.focus();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const items = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitemradio"]',
            ) ?? [],
          );
          const current = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            current < 0
              ? event.key === "ArrowDown"
                ? 0
                : items.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  items.length) %
                items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        type="button"
        className="telegram-video-control telegram-video-rate"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {text}
      </button>
      {open ? (
        <div
          className="telegram-video-options-menu"
          role="menu"
          aria-label={label}
        >
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              role="menuitemradio"
              aria-label={option.label}
              aria-description={option.description}
              aria-checked={value === option.value}
              onClick={() => {
                onChange(option.value);
                onOpenChange(false);
                root.current
                  ?.querySelector<HTMLButtonElement>(".telegram-video-control")
                  ?.focus();
              }}
            >
              <span className="telegram-video-option-text">
                <span>{option.label}</span>
                {option.description ? (
                  <small>{option.description}</small>
                ) : null}
              </span>
              {value === option.value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
