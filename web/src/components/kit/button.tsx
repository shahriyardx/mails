import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/*
 * Pills that morph toward a rounded square (rounded-xl) while pressed and
 * spring back. The radius is half the height rather than rounded-full, so
 * the change is a visible morph instead of a jump at the end.
 */
const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium outline-none " +
  "[transition:border-radius_var(--spring-spatial-fast),background-color_150ms,color_150ms,opacity_150ms] " +
  "active:not-disabled:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50";

const tones = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  tonal: "bg-tonal text-tonal-foreground hover:bg-tonal-hover aria-expanded:bg-tonal-hover",
  ghost: "text-foreground hover:bg-tonal aria-expanded:bg-tonal",
  destructive:
    "bg-destructive-soft text-destructive hover:bg-[color-mix(in_srgb,var(--destructive)_20%,var(--background))]",
};

export const buttonVariants = cva(base, {
  variants: {
    variant: tones,
    size: {
      sm: "h-8 rounded-[16px] px-3.5 text-[13px]",
      md: "h-10 rounded-[20px] px-5 text-sm",
      lg: "h-12 rounded-[24px] px-6 text-[15px]",
    },
    block: { true: "w-full" },
  },
  defaultVariants: { variant: "tonal", size: "md" },
});

const iconButtonVariants = cva(base, {
  variants: {
    variant: tones,
    size: {
      sm: "size-8 rounded-[16px]",
      md: "size-10 rounded-[20px]",
      lg: "size-12 rounded-[24px]",
    },
  },
  defaultVariants: { variant: "ghost", size: "md" },
});

const iconSize = { sm: 18, md: 20, lg: 22 } as const;

type BaseProps = Omit<ComponentProps<typeof BaseButton>, "className"> & { className?: string };

export interface ButtonProps extends BaseProps, VariantProps<typeof buttonVariants> {
  /** A Material Symbols name shown before the label. */
  icon?: string;
  /** Shows a spinner in place of the icon and blocks clicks. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  block,
  icon,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const glyph = loading ? "progress_activity" : icon;
  return (
    <BaseButton
      data-slot="button"
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    >
      {glyph && (
        <Icon
          name={glyph}
          size={iconSize[size ?? "md"]}
          className={cn("-ml-1", loading && "animate-spin")}
        />
      )}
      {children as ReactNode}
    </BaseButton>
  );
}

export interface IconButtonProps
  extends Omit<BaseProps, "children">,
    VariantProps<typeof iconButtonVariants> {
  /** Material Symbols name. */
  icon: string;
  /** Accessible name; also the tooltip text where one is used. */
  label: string;
  filled?: boolean;
  loading?: boolean;
}

/** An icon-only pill button. `label` is required so it is never unnamed. */
export function IconButton({
  className,
  variant,
  size,
  icon,
  label,
  filled,
  loading,
  disabled,
  ...props
}: IconButtonProps) {
  return (
    <BaseButton
      data-slot="icon-button"
      aria-label={label}
      disabled={disabled || loading}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      <Icon
        name={loading ? "progress_activity" : icon}
        size={iconSize[size ?? "md"]}
        filled={filled}
        className={cn(loading && "animate-spin")}
      />
    </BaseButton>
  );
}
