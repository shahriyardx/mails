import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Drawer } from "@base-ui/react/drawer";
import { type ComponentProps, createContext, type ReactNode, useContext } from "react";
import { cn } from "@/lib/cn";
import { useIsPhone } from "@/lib/hooks";
import { IconButton } from "./button";

/*
 * A dialog on wide screens; below md it is a bottom sheet that can be dragged
 * down to close (Base UI Drawer). Both share Dialog's Trigger, Close, Title
 * and Description, so only the root and the popup switch.
 */
const SheetMode = createContext(false);

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ children, onOpenChange, ...props }: DialogProps) {
  const sheet = useIsPhone();
  const change = onOpenChange && ((open: boolean) => onOpenChange(open));
  return (
    <SheetMode.Provider value={sheet}>
      {sheet ? (
        <Drawer.Root swipeDirection="down" onOpenChange={change} {...props}>
          {children}
        </Drawer.Root>
      ) : (
        <BaseDialog.Root onOpenChange={change} {...props}>
          {children}
        </BaseDialog.Root>
      )}
    </SheetMode.Provider>
  );
}

/** Pass the trigger element as `render`, e.g. render={<Button>Open</Button>}. */
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

const backdrop =
  "fixed inset-0 z-50 bg-black/45 [transition:opacity_var(--spring-effects)] data-starting-style:opacity-0 data-ending-style:opacity-0";

export function DialogContent({
  className,
  showClose = true,
  children,
}: {
  className?: string;
  /** The corner close button. Turn off when the footer already has Cancel. */
  showClose?: boolean;
  children: ReactNode;
}) {
  const sheet = useContext(SheetMode);
  const close = showClose && (
    <BaseDialog.Close
      render={
        <IconButton icon="close" label="Close" size="sm" className="absolute top-4 right-4" />
      }
    />
  );

  if (sheet) {
    return (
      <BaseDialog.Portal>
        <Drawer.Backdrop
          className={cn(
            backdrop,
            "opacity-[calc(1-var(--drawer-swipe-progress))] data-swiping:duration-0",
          )}
        />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
          <Drawer.Popup
            className={cn(
              "relative flex max-h-[90dvh] w-full flex-col overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-surface-high px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] outline-none",
              "[transform:translateY(var(--drawer-swipe-movement-y))] [transition:transform_var(--spring-spatial)]",
              "data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)] data-swiping:select-none",
              className,
            )}
          >
            <div aria-hidden className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-input" />
            <Drawer.Content className="flex flex-col gap-4">{children}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </BaseDialog.Portal>
    );
  }

  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={backdrop} />
      <BaseDialog.Viewport className="fixed inset-0 z-50 grid place-items-center p-6">
        <BaseDialog.Popup
          className={cn(
            "popup-spring relative flex max-h-[calc(100dvh-3rem)] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-surface-high p-6 shadow-[0_24px_64px_var(--shadow)] outline-none",
            className,
          )}
        >
          {close}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <BaseDialog.Title
      className={cn("font-display text-lg font-semibold tracking-[-0.02em]", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <BaseDialog.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
