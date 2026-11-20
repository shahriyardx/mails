import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/* Small chips: neutral, accent (lavender), strong (filled) or danger. */
export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[7px] font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-tonal text-soft-foreground",
        accent: "bg-accent-soft text-accent",
        strong: "bg-primary text-primary-foreground",
        danger: "bg-destructive-soft text-destructive",
      },
      size: {
        sm: "h-5 px-1.5 text-[11px]",
        md: "h-6 px-2.5 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export function Badge({
  className,
  tone,
  size,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/** A small number beside a nav item or tab. */
export function Count({ value, className }: { value: number; className?: string }) {
  if (value <= 0) return null;
  return (
    <span
      className={cn("shrink-0 font-mono text-xs text-muted-foreground tabular-nums", className)}
    >
      {value > 999 ? "999+" : value}
    </span>
  );
}
