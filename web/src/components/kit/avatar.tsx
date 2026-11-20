import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "@/lib/cn";

const sizes = { sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm" } as const;

export function initialsFor(name?: string | null, address?: string | null) {
  const source = (name || address || "?").replace(/[<>"]/g, "").trim();
  const words = source.split(/[\s._@-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : source.slice(0, 2);
  return letters.toUpperCase();
}

/** A person: their picture when given, else their initials on a tonal disc. */
export function Avatar({
  name,
  address,
  src,
  size = "md",
  className,
}: {
  name?: string | null;
  address?: string | null;
  src?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <BaseAvatar.Root
      className={cn(
        "inline-grid shrink-0 select-none place-items-center overflow-hidden rounded-full bg-selected font-medium text-foreground",
        sizes[size],
        className,
      )}
    >
      {src && <BaseAvatar.Image src={src} alt="" className="size-full object-cover" />}
      <BaseAvatar.Fallback>{initialsFor(name, address)}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
