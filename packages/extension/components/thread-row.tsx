import { cx, displayName, rowPerson, shortTime, threadSubject } from "@/lib/format";
import type { ApiThread, View } from "@/lib/types";
import { Avatar, Icon, IconButton, LabelChip } from "./kit";

/**
 * One conversation in the list, shaped like the web app's row: avatar,
 * sender (bold when unread) and mono time (lavender when unread), subject,
 * one-line snippet. The open one is a raised panel with a lavender bar. The
 * actions take the timestamp's place on hover, so a resting list is only mail.
 */

interface Props {
  thread: ApiThread;
  view: View;
  selected: boolean;
  onOpen: () => void;
  onStar: () => void;
  onArchive: () => void;
  onTrash: () => void;
}

export function ThreadRow({ thread, view, selected, onOpen, onStar, onArchive, onTrash }: Props) {
  const person = rowPerson(thread, view);
  const unread = thread.unread_count > 0;

  return (
    <div
      className={cx(
        "group relative mx-2 my-0.5 flex gap-3 rounded-xl px-3 py-2.5 transition-colors",
        selected ? "bg-surface shadow-[inset_0_0_0_1px_var(--border)]" : "hover:bg-surface",
      )}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute -left-2 top-3 bottom-3 w-0.75 rounded-r-[3px] bg-primary"
        />
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:-outline-offset-2"
        aria-label={`Open: ${threadSubject(thread)}${unread ? " (unread)" : ""}`}
      />

      <Avatar name={person.name} address={person.address} className="relative z-10 mt-0.5" />

      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cx(
              "min-w-0 flex-1 truncate text-[13.5px]",
              unread ? "font-bold text-foreground" : "font-medium text-soft-foreground",
            )}
          >
            {displayName(person)}
            {thread.message_count > 1 ? (
              <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                {thread.message_count}
              </span>
            ) : null}
          </span>

          {thread.has_attachments ? (
            <Icon name="attach_file" size={14} className="self-center text-muted-foreground" />
          ) : null}
          {thread.is_starred ? (
            <Icon name="star" size={14} filled className="self-center text-accent" />
          ) : null}
          <span
            className={cx(
              "shrink-0 font-mono text-[11.5px] tabular-nums",
              unread ? "font-medium text-accent" : "text-muted-foreground",
              !selected && "group-focus-within:invisible group-hover:invisible",
            )}
          >
            {shortTime(thread.last_message_at)}
          </span>
        </div>

        <div className={cx("truncate text-[13px] text-foreground", unread && "font-semibold")}>
          {threadSubject(thread)}
        </div>

        <div className="truncate text-[12.5px] text-muted-foreground">
          {thread.snippet || "No preview"}
        </div>

        {thread.labels && thread.labels.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {thread.labels.map((label) => (
              <LabelChip key={label.id} name={label.name} color={label.color} />
            ))}
          </div>
        ) : null}
      </div>

      {/* Sits over the timestamp, which hides itself to make room. The open
          row has its actions in the reading pane instead. */}
      {selected ? null : (
        <div className="absolute right-2 top-1.5 z-20 hidden items-center gap-0.5 rounded-lg border border-border bg-surface-high p-0.5 group-hover:flex group-focus-within:flex">
          <IconButton
            icon="star"
            filled={thread.is_starred}
            label={thread.is_starred ? "Remove star" : "Star"}
            onClick={onStar}
            className={cx("size-7", thread.is_starred && "text-accent")}
          />
          {view !== "archive" && view !== "trash" ? (
            <IconButton icon="archive" label="Archive" onClick={onArchive} className="size-7" />
          ) : null}
          <IconButton
            icon={view === "trash" ? "delete_forever" : "delete"}
            label={view === "trash" ? "Delete forever" : "Delete"}
            tone="danger"
            onClick={onTrash}
            className="size-7"
          />
        </div>
      )}
    </div>
  );
}
