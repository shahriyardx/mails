import { Progress } from "@base-ui/react/progress";
import { cn } from "@/lib/cn";

/** value 0-100, or null for an indeterminate bar. */
export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number | null;
  label?: string;
  className?: string;
}) {
  return (
    <Progress.Root value={value} aria-label={label} className={cn("w-full", className)}>
      <Progress.Track className="h-1 overflow-hidden rounded-full bg-tonal">
        <Progress.Indicator className="block h-full rounded-full bg-primary [transition:width_var(--spring-spatial)]" />
      </Progress.Track>
    </Progress.Root>
  );
}
