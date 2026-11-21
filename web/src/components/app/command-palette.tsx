import { Autocomplete } from "@base-ui/react/autocomplete";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Icon } from "@/components/kit";
import { useComposer } from "@/components/mail/composer-provider";
import { useLabels, useMailboxes } from "@/lib/api";
import { type Command, rankCommands } from "@/lib/commands";
import { FOLDER_META, FOLDERS, isFolder, mailHref, withListParam } from "@/lib/mail";
import { setSidebarCollapsed, useSidebarCollapsed } from "@/lib/sidebar";
import { useTheme } from "@/lib/theme";
import { SETTINGS_PAGES } from "@/routes/settings/pages";

/**
 * The command menu's search box and results (its own chunk, loaded on the
 * first Ctrl+K). Base UI's Autocomplete gives the combobox/listbox keyboard
 * and ARIA; rankCommands does the matching.
 */
export default function Palette({ onPick }: { onPick: (command: Command) => void }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const composer = useComposer();
  const mailboxes = useMailboxes();
  const labels = useLabels();
  const theme = useTheme();
  const folded = useSidebarCollapsed();
  const [query, setQuery] = useState("");

  // On a mail screen, folders keep the open mailbox or domain, and
  // mailboxes keep the open folder.
  const [, segment = "all", current] = pathname.match(/^\/mail\/([^/]+)\/([^/]+)/) ?? [];
  const scope = decodeURIComponent(segment);
  const folder = isFolder(current) ? current : "inbox";

  const go = (to: string) => () => navigate(to);
  const boxes = mailboxes.data ?? [];
  const nextTheme = theme.resolved === "dark" ? "light" : "dark";
  const commands: Command[] = [
    ...FOLDERS.map((f) => ({
      id: `folder:${f}`,
      label: FOLDER_META[f].label,
      hint: "Folder",
      icon: FOLDER_META[f].icon,
      run: go(mailHref(scope, f)),
    })),
    ...[...new Set(boxes.map((b) => b.domain))].sort().map((domain) => ({
      id: `domain:${domain}`,
      label: domain,
      hint: "Domain",
      icon: "language",
      run: go(mailHref(domain, folder)),
    })),
    ...boxes.map((box) => ({
      id: `mailbox:${box.id}`,
      label: box.address,
      hint: "Mailbox",
      icon: "alternate_email",
      keywords: box.display_name,
      run: go(mailHref(box.id, folder)),
    })),
    ...(labels.data ?? []).map((label) => ({
      id: `label:${label.id}`,
      label: label.name,
      hint: "Label",
      icon: "label",
      run: go(mailHref(scope, "inbox", { label: label.id })),
    })),
    ...SETTINGS_PAGES.map((page) => ({
      id: `settings:${page.path}`,
      label: page.title,
      hint: "Settings",
      icon: page.icon,
      keywords: page.description,
      run: go(`/settings/${page.path}`),
    })),
    {
      id: "docs",
      label: "Docs",
      hint: "Help",
      icon: "menu_book",
      keywords: "help documentation guide api",
      run: go("/docs"),
    },
    {
      id: "write",
      label: "Write message",
      hint: "Action",
      icon: "edit",
      keywords: "compose new email",
      run: () => composer.open(),
    },
    {
      id: "theme",
      label: "Toggle theme",
      hint: "Action",
      icon: nextTheme === "light" ? "light_mode" : "dark_mode",
      keywords: `dark light ${nextTheme}`,
      run: () => theme.setChoice(nextTheme),
    },
    {
      id: "sidebar",
      label: folded ? "Expand sidebar" : "Collapse sidebar",
      hint: "Action",
      icon: folded ? "chevron_right" : "chevron_left",
      keywords: "fold unfold navigation",
      run: () => setSidebarCollapsed(!folded),
    },
  ];

  const text = query.trim();
  const shown = rankCommands(commands, text);
  if (text) {
    // The normal search: the open list (or Inbox) with ?q=.
    const target = current
      ? `${pathname}?${withListParam(new URLSearchParams(search), "q", text)}`
      : mailHref("all", "inbox", { q: text });
    shown.push({
      id: "search",
      label: `Search mail for “${text}”`,
      hint: "Search",
      icon: "search",
      run: () => navigate(target),
    });
  }

  return (
    <Autocomplete.Root
      open
      inline
      items={shown}
      filter={null}
      value={query}
      onValueChange={setQuery}
      autoHighlight="always"
      itemToStringValue={(command: Command) => command.label}
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4">
        <Icon name="search" className="text-muted-foreground" />
        <Autocomplete.Input
          aria-label="Search commands"
          // The dialog may open before this chunk has loaded, so focus is taken here.
          autoFocus
          placeholder="Go to, search, or run a command"
          className="h-13 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <kbd className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          Esc
        </kbd>
      </div>
      <Autocomplete.Empty className="px-4 py-6 text-center text-[13px] text-muted-foreground empty:hidden">
        Nothing matches.
      </Autocomplete.Empty>
      <Autocomplete.List className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain p-1.5 empty:hidden">
        {(command: Command) => (
          <Autocomplete.Item
            key={command.id}
            value={command}
            onClick={() => onPick(command)}
            className="flex h-9 cursor-default scroll-my-1.5 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] text-soft-foreground outline-none select-none data-highlighted:bg-tonal data-highlighted:text-foreground"
          >
            <Icon name={command.icon} size={18} className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{command.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{command.hint}</span>
          </Autocomplete.Item>
        )}
      </Autocomplete.List>
    </Autocomplete.Root>
  );
}
