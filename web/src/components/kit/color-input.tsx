import { useId } from "react";
import { cn } from "@/lib/cn";
import { PALETTE } from "./color-picker";

export const SWATCHES = PALETTE;

const HEX = /^#[0-9a-f]{6}$/i;

/** Any colour: the native picker plus a hex field, kept in step. */
export function ColorInput({
  value,
  onChange,
  className,
  label = "Colour",
}: {
  value: string;
  onChange: (color: string) => void;
  className?: string;
  label?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex h-10 items-center gap-2 rounded-xl bg-field pr-3 pl-1.5", className)}>
      <input
        type="color"
        aria-label={label}
        value={HEX.test(value) ? value : "#000000"}
        onChange={(event) => onChange(event.target.value)}
        className="size-7 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
      />
      <label htmlFor={id} className="sr-only">
        {label} hex value
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none"
      />
    </div>
  );
}
