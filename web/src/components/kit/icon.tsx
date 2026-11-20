import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

export interface IconProps {
  /** A Material Symbols name listed in scripts/fetch-icons.mjs. */
  name: string;
  /** Glyph size in px. Defaults to 20. */
  size?: number;
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A Material Symbols Rounded glyph (the self-hosted font). Decorative: the
 * control around it carries the accessible name.
 */
export function Icon({ name, size = 20, filled, className, style }: IconProps) {
  return (
    <span
      aria-hidden
      data-filled={filled || undefined}
      className={cn("ms inline-grid shrink-0 place-items-center overflow-hidden", className)}
      style={{ fontSize: size, width: size, height: size, ...style }}
    >
      {name}
    </span>
  );
}
