import { Autocomplete } from "@base-ui/react/autocomplete";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { Avatar, Icon } from "@/components/kit";
import { floating } from "@/components/kit/popover";
import { useContacts } from "@/lib/api";
import { cn } from "@/lib/cn";
import { EMAIL, formatAddress, parseAddress, splitRecipients } from "@/lib/mail";
import type { Address, Contact } from "@/lib/types";

const NO_CONTACTS: Contact[] = [];

/**
 * Recipients as chips, with contact suggestions (GET /api/app/contacts).
 * Enter, comma, semicolon, Tab and a space after a whole address commit what
 * was typed; pasting a list splits it; Backspace on empty edits the last chip.
 */
export function RecipientInput({
  value,
  onChange,
  label,
  placeholder,
  autoFocus,
}: {
  value: Address[];
  onChange: (next: Address[]) => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const highlighted = useRef(false);
  const query = useDeferredValue(draft.trim());
  const contacts = useContacts(query.length >= 1 ? query : "");
  const taken = new Set(value.map((entry) => entry.address));
  // Stable identity: the autocomplete re-syncs whenever `items` changes.
  const suggestions = useMemo(
    () => (contacts.data ?? NO_CONTACTS).filter((c) => !value.some((v) => v.address === c.address)),
    [contacts.data, value],
  );

  function commit(text: string) {
    const added: Address[] = [];
    for (const token of splitRecipients(text)) {
      const entry = parseAddress(token.replace(/[,;]+$/, ""));
      if (entry.address && !taken.has(entry.address)) {
        taken.add(entry.address);
        added.push(entry);
      }
    }
    if (added.length) onChange([...value, ...added]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { key } = event;
    // Enter on a highlighted suggestion is the autocomplete's to handle.
    if (key === "Enter" && highlighted.current) return;
    if (
      key === "Enter" ||
      key === "," ||
      key === ";" ||
      (key === "Tab" && draft.trim()) ||
      (key === " " && draft.includes("@") && !draft.includes("<"))
    ) {
      if (!draft.trim()) return;
      event.preventDefault();
      commit(draft);
    } else if (key === "Backspace" && draft === "" && value.length > 0) {
      event.preventDefault();
      const last = value[value.length - 1]!;
      onChange(value.slice(0, -1));
      setDraft(formatAddress(last));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!/[,;\n]|\s\S+@/.test(text)) return;
    event.preventDefault();
    commit(`${draft},${text}`);
  }

  return (
    <Autocomplete.Root
      items={suggestions}
      filter={null}
      value={draft}
      itemToStringValue={(c: Contact) => formatAddress({ name: c.name, address: c.address })}
      onItemHighlighted={(item) => {
        highlighted.current = item !== undefined && item !== null;
      }}
      onValueChange={(next, details) => {
        if (details.reason === "item-press") commit(next);
        else setDraft(next);
      }}
    >
      <Autocomplete.InputGroup className="flex min-h-10 w-full flex-wrap items-center gap-1 py-1.5 pr-3">
        {value.map((entry) => {
          const valid = EMAIL.test(entry.address);
          return (
            <span
              key={entry.address}
              title={formatAddress(entry)}
              className={cn(
                "flex max-w-full items-center gap-1.5 rounded-full py-0.5 pr-1 pl-0.5 text-[13px]",
                valid ? "bg-tonal" : "bg-destructive-soft text-destructive",
              )}
            >
              <Avatar
                size="sm"
                name={entry.name}
                address={valid ? entry.address : undefined}
                className="size-5 text-[9px]"
              />
              <span className="truncate">{entry.name || entry.address}</span>
              <button
                type="button"
                aria-label={`Remove ${entry.address}`}
                onClick={() => onChange(value.filter((e) => e.address !== entry.address))}
                className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-tonal-hover hover:text-foreground"
              >
                <Icon name="close" size={14} />
              </button>
            </span>
          );
        })}
        <Autocomplete.Input
          aria-label={label}
          autoFocus={autoFocus}
          placeholder={value.length === 0 ? placeholder : undefined}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => draft.trim() && commit(draft)}
          className="h-7 min-w-32 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground"
        />
      </Autocomplete.InputGroup>
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} align="start" className="z-[60]">
          <Autocomplete.Popup
            className={cn(floating, "w-80 max-w-[calc(100vw-2rem)] p-1.5 empty:hidden")}
          >
            <Autocomplete.List>
              {(contact: Contact) => (
                <Autocomplete.Item
                  key={contact.id}
                  value={contact}
                  className="flex cursor-default flex-col rounded-md px-2 py-1.5 outline-none data-highlighted:bg-tonal"
                >
                  <span className="truncate text-[13px]">{contact.name || contact.address}</span>
                  {contact.name && (
                    <span className="truncate font-mono text-[11.5px] text-muted-foreground">
                      {contact.address}
                    </span>
                  )}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
