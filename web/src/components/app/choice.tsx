import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/kit";
import { cn } from "@/lib/cn";

/** A kit Select from a {value: label} map, for filters and small pickers. */
export function Choice({
  value,
  onChange,
  options,
  label,
  id,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Record<string, string>;
  /** Accessible name when no Field label points at it. */
  label?: string;
  id?: string;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => next !== null && onChange(String(next))}
      items={options}
    >
      <SelectTrigger id={id} aria-label={label} className={cn("min-w-0", className)} />
      <SelectContent>
        {Object.entries(options).map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
