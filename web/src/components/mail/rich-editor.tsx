import { type ClipboardEvent, useEffect, useRef } from "react";
import { IconButton, Tooltip } from "@/components/kit";
import { cn } from "@/lib/cn";
import { sanitizeForEditor } from "@/lib/sanitize";

const TOOLS: { icon: string; label: string; run: () => void }[] = [
  { icon: "format_bold", label: "Bold", run: () => document.execCommand("bold") },
  { icon: "format_italic", label: "Italic", run: () => document.execCommand("italic") },
  { icon: "format_underlined", label: "Underline", run: () => document.execCommand("underline") },
  {
    icon: "format_list_bulleted",
    label: "Bulleted list",
    run: () => document.execCommand("insertUnorderedList"),
  },
  {
    icon: "format_list_numbered",
    label: "Numbered list",
    run: () => document.execCommand("insertOrderedList"),
  },
  {
    icon: "format_quote",
    label: "Quote",
    run: () => document.execCommand("formatBlock", false, "blockquote"),
  },
  {
    icon: "link",
    label: "Link",
    run: () => {
      const url = window.prompt("Link address", "https://");
      if (url && /^(https?:|mailto:)/i.test(url)) document.execCommand("createLink", false, url);
    },
  },
];

/**
 * A light rich-text box: contenteditable plus the browser's own formatting
 * commands. Uncontrolled: `initialHtml` is read once (it must already be
 * sanitized), and every edit reports the current HTML.
 */
export function RichEditor({
  initialHtml,
  onChange,
  placeholder,
  className,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once on mount
  useEffect(() => {
    if (box.current) box.current.innerHTML = initialHtml;
  }, []);

  // Pasted HTML comes from anywhere: clean it before it enters the page.
  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const html = event.clipboardData.getData("text/html");
    if (!html) return;
    event.preventDefault();
    document.execCommand("insertHTML", false, sanitizeForEditor(html));
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* biome-ignore lint/a11y/useSemanticElements: rich text needs contenteditable, not a textarea */}
      <div
        ref={box}
        role="textbox"
        aria-multiline
        aria-label="Message"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        onPaste={onPaste}
        className={cn(
          "min-h-32 flex-1 overflow-y-auto px-5 py-3 text-sm leading-relaxed outline-none",
          "empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
          "[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-input [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6",
        )}
      />
      <div role="toolbar" aria-label="Formatting" className="flex shrink-0 gap-0.5 px-3 pb-1">
        {TOOLS.map((tool) => (
          <Tooltip key={tool.icon} label={tool.label} side="top">
            <IconButton
              icon={tool.icon}
              label={tool.label}
              size="sm"
              // Keep the selection in the editor while clicking.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                tool.run();
                if (box.current) onChange(box.current.innerHTML);
              }}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
