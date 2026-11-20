import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Tabs = BaseTabs.Root;

/** Underlined tabs on a hairline; the lavender indicator slides between them. */
export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <BaseTabs.List className={cn("relative z-0 flex gap-1 border-b border-border", className)}>
      {children}
      <BaseTabs.Indicator className="absolute -bottom-px left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full bg-primary [transition:translate_var(--spring-spatial),width_var(--spring-spatial)]" />
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
        "flex h-10 items-center gap-1.5 rounded-t-md px-3 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:text-soft-foreground data-active:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
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
