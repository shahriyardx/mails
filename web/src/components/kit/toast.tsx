import { Toaster as Sonner, toast } from "sonner";

export { toast };

/** Toasts: the inverse of the page, bottom centre. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={24}
      mobileOffset={16}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-xl bg-inverse px-4 py-3 text-sm text-inverse-foreground shadow-[0_12px_32px_var(--shadow)] md:w-[22rem]",
          title: "font-medium",
          description: "text-[13px] opacity-80",
          actionButton:
            "ml-auto shrink-0 rounded-md px-2.5 py-1 text-[13px] font-semibold hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)]",
          cancelButton:
            "shrink-0 rounded-md px-2.5 py-1 text-[13px] hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)]",
          error: "!bg-destructive !text-background",
        },
      }}
    />
  );
}
