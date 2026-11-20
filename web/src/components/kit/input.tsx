import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const field =
  "w-full rounded-lg border border-input bg-field px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground " +
  "focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_25%,transparent)] focus-visible:outline-none aria-invalid:border-destructive disabled:opacity-50";

type InputProps = Omit<ComponentProps<typeof BaseInput>, "className"> & {
  className?: string;
  /** "bare" drops the fill and ring, for inputs inside a composed row. */
  variant?: "field" | "bare";
};

export function Input({ className, variant = "field", ...props }: InputProps) {
  return (
    <BaseInput
      className={cn(
        variant === "field"
          ? cn(field, "h-9.5")
          : "w-full bg-transparent outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(field, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />
  );
}
