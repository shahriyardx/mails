import { cx, hueFor, initialsFor } from "@/lib/format";
import type React from "react";

/**
 * The handful of controls the popup is built from.
 *
 * A miniature of web/src/components/kit: the same variants, sizes, corners
 * and tokens (docs/design.md). Base UI is not here: nothing in the popup
 * needs a portal or focus trap.
 */

/* -------------------------------------------------------------------- icon */

/**
 * A Material Symbols Rounded glyph (the self-hosted subset in public/fonts).
 * Decorative: the control around it carries the accessible name.
 */
export function Icon({
  name,
  size = 18,
  filled,
  className,
}: {
  name: string;
  size?: number;
  filled?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-filled={filled || undefined}
      className={cx("ms inline-grid shrink-0 place-items-center overflow-hidden", className)}
      style={{ fontSize: size, width: size, height: size }}
    >
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------ button */

const TONES = {
  primary:
    "bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_88%,var(--foreground))]",
  tonal: "bg-tonal text-tonal-foreground hover:bg-tonal-hover",
  outline:
    "text-soft-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-tonal hover:text-foreground",
  ghost: "text-soft-foreground hover:bg-tonal hover:text-foreground",
  destructive:
    "bg-destructive-soft text-destructive hover:bg-[color-mix(in_srgb,var(--destructive)_22%,var(--background))]",
} as const;

const BASE =
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

const BUTTON_SIZES = {
  xs: "h-7 rounded-[7px] px-2.5 text-xs",
  sm: "h-8 rounded-lg px-3 text-[13px]",
  md: "h-9.5 rounded-[10px] px-3.5 text-sm",
} as const;

const ICON_SIZE = { xs: 16, sm: 18, md: 18 } as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof TONES;
  size?: keyof typeof BUTTON_SIZES;
  /** A Material Symbols name shown before the label. */
  icon?: string;
  /** Shows a spinner in place of the icon and blocks clicks. */
  busy?: boolean;
}

export function Button({
  variant = "tonal",
  size = "sm",
  icon,
  busy = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const glyph = busy ? "progress_activity" : icon;
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cx(BASE, TONES[variant], BUTTON_SIZES[size], className)}
      {...props}
    >
      {glyph ? (
        <Icon
          name={glyph}
          size={ICON_SIZE[size]}
          className={cx("-ml-0.5", busy && "animate-spin")}
        />
      ) : null}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Material Symbols name. */
  icon: string;
  /** The tooltip and the accessible name both. */
  label: string;
  filled?: boolean;
  spin?: boolean;
  tone?: "default" | "danger";
}

/** A square icon-only action (30px, like the web kit's `xs`). */
export function IconButton({
  icon,
  label,
  filled,
  spin,
  tone = "default",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cx(
        BASE,
        "size-7.5 rounded-lg",
        tone === "danger"
          ? "text-soft-foreground hover:bg-destructive-soft hover:text-destructive"
          : TONES.ghost,
        className,
      )}
      {...props}
    >
      <Icon name={icon} size={18} filled={filled} className={cx(spin && "animate-spin")} />
    </button>
  );
}

/* --------------------------------------------------------------------- chip */

/** A round filter chip, like the web list's: the picked one is inverted. */
export function Chip({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cx(
        "shrink-0 whitespace-nowrap rounded-full px-2.75 py-1 text-[12.5px] font-semibold transition-colors",
        active
          ? "bg-foreground text-background"
          : "bg-tonal text-soft-foreground hover:bg-tonal-hover hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ inputs */

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-9.5 w-full rounded-lg border border-input bg-field px-3 text-sm text-foreground transition-[border-color,box-shadow]",
        "placeholder:text-muted-foreground focus:border-primary focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_22%,transparent)] focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

interface FieldProps {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[13px] font-medium">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs text-destructive">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}

export function Switch({ checked, onChange, label, hint }: SwitchProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint ? <div className="text-[13px] text-muted-foreground">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-5.5 w-9.5 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cx(
            "absolute top-0.75 size-4 rounded-full transition-all",
            checked ? "left-4.75 bg-primary-foreground" : "left-0.75 bg-foreground",
          )}
        />
      </button>
    </div>
  );
}

interface ChoiceProps<T extends string | number> {
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange: (value: T) => void;
  label: string;
}

/**
 * A row of options, one of which is on: a segmented control in place of a
 * `<select>`, whose list the operating system draws in its own colours.
 */
export function Choice<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: ChoiceProps<T>) {
  return (
    <div className="flex flex-wrap gap-1 rounded-[10px] bg-tonal p-1">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-label={`${label}: ${option.label}`}
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cx(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2 py-1.5 text-[13px] font-medium transition-colors",
              on
                ? "bg-surface-high text-foreground shadow-[0_0_0_1px_var(--input)]"
                : "text-soft-foreground hover:text-foreground",
            )}
          >
            {option.icon ? <Icon name={option.icon} size={16} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ avatar */

const AVATAR_SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-[13px]",
} as const;

/**
 * Initials on a tint whose hue comes from the address (web's avatar). No
 * picture: the dashboard's avatar endpoint needs a session, not an API key.
 */
export function Avatar({
  name,
  address,
  size = "md",
  className,
}: {
  name?: string | null;
  address?: string | null;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "avatar-tint inline-grid shrink-0 select-none place-items-center rounded-full font-semibold",
        AVATAR_SIZES[size],
        className,
      )}
      style={{ "--h": hueFor(address || name || "?") } as React.CSSProperties}
    >
      {initialsFor(name, address)}
    </span>
  );
}

/* ------------------------------------------------------------- odds and ends */

/** The mark: a lavender diamond, as in the web sidebar. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-2.5 shrink-0 rotate-45 rounded-[3px] bg-primary", className)}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Icon
      name="progress_activity"
      size={20}
      className={cx("animate-spin text-muted-foreground", className)}
    />
  );
}

interface EmptyStateProps {
  icon?: string;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-12 text-center">
      {icon ? (
        <div className="mb-1 grid size-12 place-items-center rounded-full bg-tonal text-soft-foreground">
          <Icon name={icon} size={24} />
        </div>
      ) : null}
      <div className="font-display text-[15px] font-semibold">{title}</div>
      {body ? <div className="text-[13px] text-muted-foreground">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A label: its colour as a small square on a tonal chip (web's row labels). */
export function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-tonal px-1.5 py-px text-[11px] font-medium text-soft-foreground">
      <span aria-hidden className="size-1.5 rounded-[2px]" style={{ background: color }} />
      {name}
    </span>
  );
}

/** Rows of grey while the real thing is on its way. */
export function RowSkeleton() {
  return (
    <div className="mx-2 flex gap-3 px-3 py-2.5">
      <div className="size-9 shrink-0 animate-pulse rounded-full bg-tonal" />
      <div className="min-w-0 flex-1 space-y-2 py-0.5">
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-tonal" />
        <div className="h-2.5 w-3/4 animate-pulse rounded bg-tonal" />
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-tonal" />
      </div>
    </div>
  );
}
