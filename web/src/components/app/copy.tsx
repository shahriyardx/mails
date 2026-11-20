import { useState } from "react";
import { Icon, IconButton, toast } from "@/components/kit";
import { cn } from "@/lib/cn";

/** Copies text, with a check for a moment and a toast if the browser refuses. */
export function CopyButton({
  text,
  label = "Copy",
  size = "sm",
  className,
}: {
  text: string;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? "check" : "content_copy"}
      label={copied ? "Copied" : label}
      size={size}
      className={className}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => toast.error("Could not copy. Select the text and copy it by hand."),
        )
      }
    />
  );
}

/**
 * A secret the server shows once (an API key token, a webhook signing
 * secret): a warning, the value in mono, and a copy button.
 */
export function OnceSecret({
  value,
  title,
  onDismiss,
  className,
}: {
  value: string;
  title: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div role="status" className={cn("flex flex-col gap-3 rounded-3xl bg-box p-4", className)}>
      <div className="flex items-start gap-3">
        <Icon name="warning" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-[13px] text-muted-foreground">
            Copy it now and keep it somewhere safe. It will not be shown again.
          </p>
        </div>
        {onDismiss && (
          <IconButton icon="close" label="I have copied it" size="sm" onClick={onDismiss} />
        )}
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-field py-1 pr-1 pl-3.5">
        <code className="min-w-0 flex-1 break-all font-mono text-[13px] select-all">{value}</code>
        <CopyButton text={value} label="Copy secret" size="md" />
      </div>
    </div>
  );
}

/** Preformatted text (JSON, a response, a code sample) with a copy button. */
export function CodeBlock({
  title,
  text,
  className,
}: {
  title?: string;
  text: string;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-field", className)}>
      {title ? (
        <div className="flex items-center justify-between py-1 pr-1 pl-3.5 font-mono text-xs text-muted-foreground">
          {title}
          <CopyButton text={text} label={`Copy ${title.toLowerCase()}`} />
        </div>
      ) : (
        <CopyButton text={text} className="absolute top-1.5 right-1.5" />
      )}
      <pre
        className={cn(
          "max-h-[32rem] overflow-auto px-3.5 pb-3 font-mono text-xs leading-relaxed",
          !title && "pt-3 pr-12",
        )}
      >
        {text}
      </pre>
    </div>
  );
}
