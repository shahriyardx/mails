import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

type Props = Omit<ComponentProps<typeof BaseCheckbox.Root>, "className"> & { className?: string };

export function Checkbox({ className, ...props }: Props) {
  return (
    <BaseCheckbox.Root
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px] border-muted-foreground text-primary-foreground outline-none transition-colors",
        "data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator
        className="grid place-items-center"
        render={(props, state) => (
          <span {...props}>
            <Icon name={state.indeterminate ? "remove" : "check"} size={14} className="font-bold" />
          </span>
        )}
      />
    </BaseCheckbox.Root>
  );
}
