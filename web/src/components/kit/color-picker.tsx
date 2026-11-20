import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/** Label colours: muted, so a label reads as a tag, not an alarm. */
export const PALETTE = [
  "#9aa5b1",
  "#8fa8c8",
  "#8bb4a8",
  "#a3b38a",
  "#c8b47e",
  "#c99a7f",
  "#c48b8b",
  "#b08fb8",
] as const;

/** A row of swatches. */
export function ColorPicker({
  value,
  onChange,
  palette = PALETTE,
  label = "Colour",
}: {
  value: string;
  onChange: (color: string) => void;
  palette?: readonly string[];
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {palette.map((color) => {
        const on = color.toLowerCase() === value.toLowerCase();
        return (
          // biome-ignore lint/a11y/useSemanticElements: a swatch button with radio semantics
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={color}
            onClick={() => onChange(color)}
            className={cn(
              "grid size-8 place-items-center rounded-full text-background outline-none transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              on && "ring-2 ring-foreground ring-offset-2 ring-offset-surface-high",
            )}
            style={{ background: color }}
          >
            {on && <Icon name="check" size={16} />}
          </button>
        );
      })}
    </div>
  );
}
