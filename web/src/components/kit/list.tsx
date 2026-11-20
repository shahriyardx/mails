import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/** A panel of rows split by hairlines, for settings pages (domains, keys, labels...). */
export function List({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      className={cn(
        "flex flex-col divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function ListRow({
  icon,
  title,
  description,
  action,
  className,
  children,
}: {
  icon?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or a menu at the end of the row. */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "group/row flex min-h-15 items-center gap-3 px-4 py-3 transition-colors hover:bg-box",
        className,
      )}
    >
      {icon && (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-tonal text-soft-foreground">
          <Icon name={icon} size={18} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        {description && (
          <div className="truncate font-mono text-xs text-muted-foreground">{description}</div>
        )}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </li>
  );
}

export function ListEmpty({ children }: { children: ReactNode }) {
  return <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">{children}</li>;
}
