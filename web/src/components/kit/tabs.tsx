import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Tabs = BaseTabs.Root;

/** A pill track whose indicator slides between tabs. */
export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <BaseTabs.List
      className={cn("relative z-0 inline-flex gap-1 rounded-full bg-surface p-1", className)}
    >
      {children}
      <BaseTabs.Indicator className="absolute top-1/2 left-0 -z-10 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) -translate-y-1/2 rounded-full bg-tonal-hover [transition:translate_var(--spring-spatial),width_var(--spring-spatial)]" />
    </BaseTabs.List>
  );
}

export function TabsTab({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseTabs.Tab>, "className"> & { className?: string }) {
  return (
    <BaseTabs.Tab
      className={cn(
        "h-8 rounded-full px-4 text-[13px] font-medium text-muted-foreground outline-none transition-colors data-active:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseTabs.Panel>, "className"> & { className?: string }) {
  return <BaseTabs.Panel className={cn("outline-none", className)} {...props} />;
}
