import { cn } from "@/lib/cn";

/** The mark: an envelope flap on a soft disc. Matches public/favicon.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="10" fill="var(--primary)" />
      <path
        d="M8 11.5 16 17l8-5.5M9.5 10h13a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 20.5v-9A1.5 1.5 0 0 1 9.5 10Z"
        fill="none"
        stroke="var(--background)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logo />
      <span className="text-[17px] font-semibold tracking-tight">Mails</span>
    </span>
  );
}
