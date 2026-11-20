import { Field as BaseField } from "@base-ui/react/field";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A labelled form control. Put a kit Input (or any Base UI control) inside:
 * Base UI wires the label, description and error to it.
 */
export function Field({
  label,
  description,
  error,
  className,
  children,
}: {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseField.Root invalid={Boolean(error)} className={cn("flex flex-col gap-1.5", className)}>
      {label && <BaseField.Label className="text-[13px] font-medium">{label}</BaseField.Label>}
      {children}
      {description && (
        <BaseField.Description className="text-xs text-muted-foreground">
          {description}
        </BaseField.Description>
      )}
      {error && (
        <BaseField.Error match className="text-xs text-destructive">
          {error}
        </BaseField.Error>
      )}
    </BaseField.Root>
  );
}

/** A plain label for controls outside a Field. */
export function Label({ className, ...props }: React.ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor or wrap the control
  return <label className={cn("text-[13px] font-medium", className)} {...props} />;
}
