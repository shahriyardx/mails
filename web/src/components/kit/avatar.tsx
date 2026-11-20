import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "@/lib/cn";

const sizes = { sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm" } as const;

export function initialsFor(name?: string | null, address?: string | null) {
  // A name gives two initials ("Ada Lovelace" -> AL); a bare address one.
  const words = (name ?? "").replace(/[<>"]/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0]![0]! + words.at(-1)![0]!).toUpperCase();
  return (words[0] ?? address ?? "?").slice(0, 1).toUpperCase();
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
