// Small pieces the settings pages share. Everything visual still comes from
// the kit; these only compose it.
import { createContext, type ReactNode, useContext, useId } from "react";
import { createPortal } from "react-dom";
import { Button, Card, EmptyState, Icon, Skeleton, Switch, toast } from "@/components/kit";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

/** Where the settings layout puts a page's primary action (right of the title). */
export const PageActionSlot = createContext<HTMLElement | null>(null);

/**
 * The page's primary action, shown on the title row:
 * <PageAction><Button variant="primary" icon="add">Add domain</Button></PageAction>
 */
export function PageAction({ children }: { children: ReactNode }) {
  const slot = useContext(PageActionSlot);
  return slot ? createPortal(children, slot) : null;
}

const DOT = {
  ok: "bg-[#5fbf8a]",
  pending: "bg-[#d9a54a]",
  bad: "bg-destructive",
  off: "bg-muted-foreground",
} as const;

/** A status as a small coloured dot and a word: Verified, Pending, Failing. */
export function StatusDot({
  tone,
  children,
  className,
}: {
  tone: keyof typeof DOT;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
        tone === "bad" ? "text-destructive" : "text-soft-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.75 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

/** A row's actions: shown on hover or focus on pointer screens, always on touch. */
export const rowActions =
  "transition-opacity md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:has-[[aria-expanded=true]]:opacity-100";

/** An empty list: one short sentence (the add button is on the title row). */
export const emptyBox = "rounded-[14px] border border-dashed border-border px-6 py-8 text-center";

/** A titled part of a page: a heading and a muted line, no box around it. */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The last card on a page, for what cannot be undone. */
export function DangerZone({
  title = "Danger zone",
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-[color-mix(in_srgb,var(--destructive)_45%,var(--border))] bg-surface p-5">
      <h2 className="text-base font-semibold text-destructive">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** One thing in the danger zone: what it does, and the button that does it. */
export function DangerRow({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Copies text, saying so in a toast either way. */
export function copyText(text: string) {
  navigator.clipboard.writeText(text).then(
    () =>
      toast.success("Copied", { description: text.length > 80 ? `${text.slice(0, 80)}…` : text }),
    () => toast.error("Could not copy. Select the value and copy it by hand."),
  );
}

/** A value read as data (mono), copied on click. `copy` overrides what is copied. */
export function CopyValue({
  value,
  copy,
  label,
  className,
}: {
  value: string;
  copy?: string;
  /** Accessible name, e.g. "Copy record name". */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`${label}: ${copy ?? value}`}
      onClick={() => copyText(copy ?? value)}
      className={cn(
        "group flex w-full min-w-0 items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left font-mono text-[13px] outline-none transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <span className="min-w-0 flex-1 break-all">{value}</span>
      <Icon name="content_copy" size={16} className="mt-0.5 text-muted-foreground" />
    </button>
  );
}

/** Something to know (info), something blocking (warning), or a failure (danger). */
export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger";
  children: ReactNode;
  className?: string;
}) {
  const icon = { info: "info", warning: "warning", danger: "error" }[tone];
  return (
    <div
      role={tone === "info" ? undefined : "alert"}
      className={cn(
        "flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px] leading-relaxed",
        tone === "danger"
          ? "border-transparent bg-destructive-soft text-destructive"
          : tone === "warning"
            ? "border-[color-mix(in_srgb,#d9a54a_45%,var(--border))] bg-surface"
            : "border-border bg-surface",
        className,
      )}
    >
      <Icon
        name={icon}
        size={18}
        className={cn("mt-px", tone === "info" && "text-muted-foreground")}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A switch with its label and explanation, wired for screen readers. */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex gap-3", description ? "items-start" : "items-center", className)}>
      <div className="min-w-0 flex-1">
        <div id={`${id}-l`} className="text-[13px] font-medium">
          {label}
        </div>
        {description && (
          <div id={`${id}-d`} className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        className={description ? "mt-0.5" : undefined}
      />
    </div>
  );
}

/** While a page's first load runs. */
export function PageLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-32 rounded-[14px]" />
      <Skeleton className="h-48 rounded-[14px]" />
    </div>
  );
}

/** A failed first load, with a retry. */
export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Card>
      <EmptyState
        icon="cloud"
        title="Could not load this page"
        body={errorMessage(error)}
        action={<Button onClick={retry}>Try again</Button>}
      />
    </Card>
  );
}

/** Runs a mutation from a click: a toast on success, the error as a toast on failure. */
export function toastResult<T>(promise: Promise<T>, success: string | ((value: T) => string)) {
  return promise.then(
    (value) => {
      toast.success(typeof success === "string" ? success : success(value));
      return value;
    },
    (error) => {
      toast.error(errorMessage(error));
      return undefined;
    },
  );
}
