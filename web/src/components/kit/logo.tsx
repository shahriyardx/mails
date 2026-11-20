import { cn } from "@/lib/cn";

/** The mark: a lavender diamond. Matches public/favicon.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rotate-45 rounded-[3px] bg-primary", className)}
    />
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
