import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/** What an empty list or a failed load says, centred in its space. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: string;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-16 text-center", className)}>
      {icon && (
        <span className="text-muted-foreground">
          <Icon name={icon} size={24} />
        </span>
      )}
      <div className="max-w-72 space-y-1">
        <p className="font-display text-[15px] font-semibold">{title}</p>
        {body && <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>}
      </div>
      {action}
    </div>
  );
}

/** A placeholder block while something loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-tonal", className)} />;
}
