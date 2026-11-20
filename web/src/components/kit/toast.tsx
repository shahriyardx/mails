import { Toaster as Sonner, toast } from "sonner";

export { toast };

/** Snackbars: the inverse of the page, bottom centre, Material style. */
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
            "flex w-full items-center gap-3 rounded-2xl bg-inverse px-4 py-3 text-sm text-inverse-foreground shadow-[0_12px_40px_rgb(0_0_0/0.4)] md:w-[22rem]",
          title: "font-medium",
          description: "text-[13px] opacity-80",
          actionButton:
            "ml-auto shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold hover:bg-black/10",
          cancelButton: "shrink-0 rounded-full px-3 py-1.5 text-[13px] hover:bg-black/10",
          error: "!bg-destructive !text-background",
        },
      }}
    />
  );
}
