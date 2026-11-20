// Small pieces the settings pages share. Everything visual still comes from
// the kit; these only compose it.
import { type ReactNode, useId } from "react";
import { Button, Card, EmptyState, Icon, Skeleton, Switch, toast } from "@/components/kit";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

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
        "group flex w-full min-w-0 items-start gap-2 rounded-xl bg-field px-3 py-2 text-left font-mono text-[13px] outline-none hover:bg-field-box focus-visible:outline-2 focus-visible:outline-ring",
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
        "flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[13px] leading-relaxed",
        tone === "danger" ? "bg-destructive-soft text-destructive" : "bg-box",
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
    <div className={cn("flex items-start gap-3", className)}>
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
        className="mt-0.5"
      />
    </div>
  );
}

/** While a page's first load runs. */
export function PageLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-32 rounded-3xl" />
      <Skeleton className="h-48 rounded-3xl" />
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
