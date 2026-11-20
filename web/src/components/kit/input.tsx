import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const field =
  "w-full rounded-xl bg-field px-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring aria-invalid:outline-2 aria-invalid:outline-destructive disabled:opacity-50";

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
          ? cn(field, "h-10")
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
