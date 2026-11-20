import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Props = Omit<ComponentProps<typeof BaseSwitch.Root>, "className"> & { className?: string };

export function Switch({ className, ...props }: Props) {
  return (
    <BaseSwitch.Root
      className={cn(
        "relative inline-flex h-5.5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors",
        "data-checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          "size-4.5 rounded-full bg-foreground [transition:translate_var(--spring-spatial-fast),background-color_150ms]",
          "data-checked:translate-x-3.5 data-checked:bg-primary-foreground",
        )}
      />
    </BaseSwitch.Root>
  );
}
