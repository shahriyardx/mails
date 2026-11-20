import { type CSSProperties, useState } from "react";
import { cn } from "@/lib/cn";

const sizes = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10.5 text-sm",
  xl: "size-11.5 text-[15px]",
} as const;

export function initialsFor(name?: string | null, address?: string | null) {
  // A name gives two initials ("Ada Lovelace" -> AL); a bare address one.
  const words = (name ?? "").replace(/[<>"]/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0]![0]! + words.at(-1)![0]!).toUpperCase();
  return (words[0] ?? address ?? "?").slice(0, 1).toUpperCase();
}

/** A stable hue (0-359) for an address, so a person keeps their colour. */
export function hueFor(key: string) {
  let hash = 0;
  for (const char of key.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/**
 * A person: their initials on a tint from their address, with a picture laid
 * over once it has loaded. With an address and no `src`, the picture comes
 * from GET /api/app/avatar (brand logo, Gravatar or site icon; 404 when there
 * is none). The image stays invisible until onLoad and is dropped on error,
 * so a missing picture never shows as a broken image.
 */
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
  const url = src ?? (address ? `/api/app/avatar?address=${encodeURIComponent(address)}` : "");
  const [state, setState] = useState<{ url: string; status: "loading" | "loaded" | "failed" }>({
    url,
    status: "loading",
  });
  const status = state.url === url ? state.status : "loading";
  return (
    <span
      className={cn(
        "avatar-tint relative inline-grid shrink-0 select-none place-items-center overflow-hidden rounded-full font-semibold",
        sizes[size],
        className,
      )}
      style={{ "--h": hueFor(address || name || "?") } as CSSProperties}
    >
      {initialsFor(name, address)}
      {url && status !== "failed" && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setState({ url, status: "loaded" })}
          onError={() => setState({ url, status: "failed" })}
          className={cn(
            "absolute inset-0 size-full bg-surface object-cover transition-opacity duration-200",
            status === "loaded" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </span>
  );
}
