import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** One number with its name, for overview and metrics pages. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-3xl bg-surface p-5", className)}>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl font-medium tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function Stats({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}
