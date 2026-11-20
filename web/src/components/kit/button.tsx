import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/*
 * Flat buttons with 8-10px corners. No press morph: hover and press only
 * change the fill, so nothing moves under the pointer.
 */
const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium outline-none " +
  "transition-[background-color,color,box-shadow,opacity] duration-150 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50";

const tones = {
  primary:
    "bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_88%,var(--foreground))] active:bg-[color-mix(in_srgb,var(--primary)_80%,var(--foreground))]",
  tonal: "bg-tonal text-tonal-foreground hover:bg-tonal-hover aria-expanded:bg-tonal-hover",
  outline:
    "text-soft-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-tonal hover:text-foreground aria-expanded:bg-tonal",
  ghost: "text-soft-foreground hover:bg-tonal hover:text-foreground aria-expanded:bg-tonal",
  destructive:
    "bg-destructive-soft text-destructive hover:bg-[color-mix(in_srgb,var(--destructive)_22%,var(--background))]",
};

export const buttonVariants = cva(base, {
  variants: {
    variant: tones,
    size: {
      xs: "h-7 rounded-[7px] px-2.5 text-xs",
      sm: "h-8 rounded-lg px-3 text-[13px]",
      md: "h-9.5 rounded-[10px] px-3.5 text-sm",
      lg: "h-11 rounded-[10px] px-5 text-[15px]",
    },
    block: { true: "w-full" },
  },
  defaultVariants: { variant: "tonal", size: "md" },
});

const iconButtonVariants = cva(base, {
  variants: {
    variant: tones,
    size: {
      xs: "size-7.5 rounded-lg",
      sm: "size-8 rounded-lg",
      md: "size-9.5 rounded-[10px]",
      lg: "size-11 rounded-[10px]",
    },
  },
  defaultVariants: { variant: "ghost", size: "md" },
});

const iconSize = { xs: 16, sm: 18, md: 18, lg: 20 } as const;

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
          className={cn("-ml-0.5", loading && "animate-spin")}
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

/** An icon-only button. `label` is required so it is never unnamed. */
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
