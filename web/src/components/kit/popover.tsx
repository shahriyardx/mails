import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Shared look for every floating panel: menus, popovers, selects. */
export const floating =
  "popup-spring z-50 rounded-xl border border-border bg-surface-high text-foreground shadow-[0_12px_32px_var(--shadow)] outline-none";

export const Popover = BasePopover.Root;
export const PopoverClose = BasePopover.Close;

/** Pass the trigger element as `render`, e.g. render={<IconButton .../>}. */
export const PopoverTrigger = BasePopover.Trigger;

type Side = "top" | "bottom" | "left" | "right";

export function PopoverContent({
  className,
  side = "bottom",
  align = "center",
  sideOffset = 8,
  children,
  ...props
}: Omit<ComponentProps<typeof BasePopover.Popup>, "className"> & {
  className?: string;
  side?: Side;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  children: ReactNode;
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
        <BasePopover.Popup className={cn(floating, "p-4", className)} {...props}>
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
