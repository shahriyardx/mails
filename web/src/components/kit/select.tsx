import { Select as BaseSelect } from "@base-ui/react/select";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import { floating } from "./popover";

/** Pass `items` ({value: label}) so the trigger shows the label, not the value. */
export const Select = BaseSelect.Root;

export function SelectTrigger({
  className,
  placeholder,
  variant = "field",
  ...props
}: Omit<ComponentProps<typeof BaseSelect.Trigger>, "className"> & {
  className?: string;
  placeholder?: string;
  variant?: "field" | "bare";
}) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "flex h-10 min-w-0 items-center gap-2 text-left text-sm outline-none focus-visible:outline-2 focus-visible:outline-ring",
        variant === "field" && "rounded-xl bg-field px-3.5",
        className,
      )}
      {...props}
    >
      <BaseSelect.Value placeholder={placeholder} className="min-w-0 flex-1 truncate" />
      <BaseSelect.Icon className="text-muted-foreground">
        <Icon name="expand_more" size={18} />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

export function SelectContent({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-50">
        <BaseSelect.Popup
          className={cn(
            floating,
            "max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1.5",
            className,
          )}
        >
          <BaseSelect.List>{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof BaseSelect.Item>, "className"> & { className?: string }) {
  return (
    <BaseSelect.Item
      className={cn(
        "flex h-9 cursor-default select-none items-center gap-2 rounded-xl px-2.5 text-[13px] outline-none data-highlighted:bg-tonal-hover",
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemText className="min-w-0 flex-1 truncate">{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator>
        <Icon name="check" size={18} />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}
