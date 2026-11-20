import { useId } from "react";
import { cn } from "@/lib/cn";

/** The mark: the folded diamond. Matches public/favicon.svg. */
export function Logo({ className }: { className?: string }) {
  const clip = useId();
  return (
    <svg aria-hidden viewBox="0 0 128 128" className={cn("size-4 shrink-0", className)}>
      <clipPath id={clip}>
        <rect width="128" height="64" />
      </clipPath>
      <rect
        x="22"
        y="22"
        width="84"
        height="84"
        rx="16"
        fill="#8f80f0"
        transform="rotate(45 64 64)"
      />
      <rect
        x="22"
        y="22"
        width="84"
        height="84"
        rx="16"
        fill="#c8bff9"
        transform="rotate(45 64 64)"
        clipPath={`url(#${clip})`}
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logo />
      <span className="font-display text-[19px] font-bold tracking-[-0.02em]">Mails</span>
    </span>
  );
}
