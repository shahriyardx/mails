import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Mount once near the root so neighbouring tooltips open without delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={500}>{children}</BaseTooltip.Provider>;
}

/**
 * A short hint on hover/focus. The child element is the trigger:
 * <Tooltip label="Archive"><IconButton .../></Tooltip>
 */
export function Tooltip({
  label,
  side = "bottom",
  children,
  className,
}: {
  label: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
  className?: string;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
          <BaseTooltip.Popup
            className={cn(
              "popup-spring rounded-md bg-inverse px-2 py-1 text-xs font-medium text-inverse-foreground",
              className,
            )}
          >
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
