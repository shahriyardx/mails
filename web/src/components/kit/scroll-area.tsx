import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

/** A scroll container with a thin overlay scrollbar. */
export function ScrollArea({
  className,
  viewportRef,
  children,
}: {
  className?: string;
  viewportRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <BaseScrollArea.Root className={cn("relative min-h-0 overflow-hidden", className)}>
      <BaseScrollArea.Viewport
        ref={viewportRef}
        className="size-full overscroll-contain outline-none"
      >
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        orientation="vertical"
        className="m-1 flex w-1.5 justify-center rounded-full opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100"
      >
        <BaseScrollArea.Thumb className="w-full rounded-full bg-input" />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  );
}
