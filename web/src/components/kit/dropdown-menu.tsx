import { Menu } from "@base-ui/react/menu";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import { floating } from "./popover";

export const DropdownMenu = Menu.Root;
/** Pass the trigger element as `render`, e.g. render={<IconButton .../>}. */
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export function DropdownMenuContent({
  className,
  side = "bottom",
  align = "end",
  children,
}: {
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner side={side} align={align} sideOffset={6} className="z-50">
        <Menu.Popup
          className={cn(
            floating,
            "max-h-(--available-height) min-w-48 overflow-y-auto p-1",
            className,
          )}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

const item =
  "flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2 text-[13px] text-soft-foreground outline-none " +
  "data-highlighted:bg-tonal data-highlighted:text-foreground data-disabled:opacity-50";

type ItemProps = Omit<ComponentProps<typeof Menu.Item>, "className"> & {
  className?: string;
  icon?: string;
  destructive?: boolean;
};

export function DropdownMenuItem({ className, icon, destructive, children, ...props }: ItemProps) {
  return (
    <Menu.Item className={cn(item, destructive && "text-destructive", className)} {...props}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Menu.Item>
  );
}

/** A menu item that navigates: render={<Link to="..." />}. */
export function DropdownMenuLinkItem({
  className,
  icon,
  children,
  ...props
}: Omit<ComponentProps<typeof Menu.LinkItem>, "className"> & {
  className?: string;
  icon?: string;
}) {
  return (
    <Menu.LinkItem className={cn(item, className)} {...props}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Menu.LinkItem>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Menu.CheckboxItem>, "className"> & { className?: string }) {
  return (
    <Menu.CheckboxItem className={cn(item, className)} {...props}>
      <span className="grid size-[18px] place-items-center">
        <Menu.CheckboxItemIndicator>
          <Icon name="check" size={18} />
        </Menu.CheckboxItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="-mx-1 my-1 h-px bg-border" />;
}
