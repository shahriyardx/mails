import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/** A rounded group of rows, for settings pages (domains, keys, labels...). */
export function List({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      className={cn(
        "flex flex-col gap-0.5 overflow-hidden rounded-3xl bg-surface p-1.5",
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
        "flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-box",
        className,
      )}
    >
      {icon && (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tonal text-muted-foreground">
          <Icon name={icon} size={18} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {description && (
          <div className="truncate text-[13px] text-muted-foreground">{description}</div>
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
