import { toast } from "@/components/kit";
import { errorMessage, useChangeThreads, useDeleteThreads, useRestoreThreads } from "@/lib/api";
import { FOLDER_META } from "@/lib/mail";
import { snoozeLabel } from "@/lib/snooze";
import type { Folder } from "@/lib/types";

const count = (ids: string[]) =>
  ids.length === 1 ? "Conversation" : `${ids.length} conversations`;

/**
 * Every thread action the screens offer, with one toast style and an Undo
 * wherever the action can be taken back. Lists update before the server
 * answers (see useChangeThreads). Callbacks hang off mutateAsync: TanStack
 * runs per-call mutate() callbacks only for the latest call, so a quick
 * second action would swallow the first one's Undo or error toast.
 */
export function useThreadActions() {
  const change = useChangeThreads();
  const remove = useDeleteThreads();
  const restore = useRestoreThreads();
  const fail = (error: unknown) => toast.error(errorMessage(error));

  return {
    pending: change.isPending || remove.isPending || restore.isPending,

    /** Moves to a folder. `from` (a movable folder) enables Undo. */
    move(ids: string[], folder: Folder, from?: Folder) {
      change.mutateAsync({ ids, change: { folder } }).then(
        () =>
          toast(`${count(ids)} moved to ${FOLDER_META[folder].label}`, {
            action: from
              ? { label: "Undo", onClick: () => change.mutate({ ids, change: { folder: from } }) }
              : undefined,
          }),
        fail,
      );
    },

    /** Moves to Trash, undoable. */
    trash(ids: string[]) {
      remove.mutateAsync({ ids }).then(
        () =>
          toast(`${count(ids)} moved to Trash`, {
            action: { label: "Undo", onClick: () => restore.mutate(ids) },
          }),
        fail,
      );
    },

    /** Deletes for good. Ask first (ConfirmDialog). */
    purge(ids: string[]) {
      return remove.mutateAsync({ ids, permanent: true });
    },

    restore(ids: string[]) {
      restore.mutateAsync(ids).then(() => toast(`${count(ids)} put back`), fail);
    },

    setRead(ids: string[], is_read: boolean) {
      change.mutateAsync({ ids, change: { is_read } }).catch(fail);
    },

    setStarred(ids: string[], is_starred: boolean) {
      change.mutateAsync({ ids, change: { is_starred } }).catch(fail);
    },

    /** Snoozes until an ISO time (undoable), or wakes now with null. */
    snooze(ids: string[], until: string | null) {
      change.mutateAsync({ ids, change: { snoozed_until: until } }).then(
        () =>
          toast(
            until
              ? `${count(ids)} snoozed until ${snoozeLabel(new Date(until))}`
              : `${count(ids)} back in the Inbox`,
            {
              action: until
                ? {
                    label: "Undo",
                    onClick: () => change.mutate({ ids, change: { snoozed_until: null } }),
                  }
                : undefined,
            },
          ),
        fail,
      );
    },
  };
}

/** Where Undo sends an archived or trashed thread back to. */
export function movableFolder(folder: string): Folder | undefined {
  return folder === "inbox" || folder === "archive" || folder === "spam" ? folder : undefined;
}
