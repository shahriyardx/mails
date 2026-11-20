import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Drawer } from "@base-ui/react/drawer";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A panel from the left or right edge, swiped back out to close. */
export function Sheet({
  side = "left",
  open,
  onOpenChange,
  children,
}: {
  side?: "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Drawer.Root
      swipeDirection={side}
      open={open}
      onOpenChange={onOpenChange && ((next) => onOpenChange(next))}
    >
      {children}
    </Drawer.Root>
  );
}

export const SheetTrigger = BaseDialog.Trigger;
export const SheetClose = BaseDialog.Close;

export function SheetContent({
  side = "left",
  className,
  children,
}: {
  side?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  const out = side === "left" ? "-100%" : "100%";
  return (
    <BaseDialog.Portal>
      <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/45 opacity-[calc(1-var(--drawer-swipe-progress))] [transition:opacity_var(--spring-effects)] data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:duration-0" />
      <Drawer.Viewport
        className={cn("fixed inset-0 z-50 flex", side === "left" ? "justify-start" : "justify-end")}
      >
        <Drawer.Popup
          style={{ "--sheet-out": out } as React.CSSProperties}
          className={cn(
            "flex h-full w-[min(20rem,calc(100vw-3rem))] flex-col overflow-y-auto overscroll-contain border-border bg-background outline-none",
            side === "left" ? "border-r" : "border-l",
            "[transform:translateX(var(--drawer-swipe-movement-x))] [transition:transform_var(--spring-spatial)]",
            "data-starting-style:[transform:translateX(var(--sheet-out))] data-ending-style:[transform:translateX(var(--sheet-out))]",
            className,
          )}
        >
          {children}
        </Drawer.Popup>
      </Drawer.Viewport>
    </BaseDialog.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <BaseDialog.Title
      className={cn("font-display text-base font-semibold", className)}
      {...props}
    />
  );
}
