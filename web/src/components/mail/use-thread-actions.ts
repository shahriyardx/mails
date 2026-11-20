import { toast } from "@/components/kit";
import { errorMessage, useChangeThreads, useDeleteThreads, useRestoreThreads } from "@/lib/api";
import { FOLDER_META } from "@/lib/mail";
import type { Folder } from "@/lib/types";

const count = (ids: string[]) =>
  ids.length === 1 ? "Conversation" : `${ids.length} conversations`;

/**
 * Every thread action the screens offer, with one toast style and an Undo
 * wherever the action can be taken back. Lists update before the server
 * answers (see useChangeThreads).
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
      change.mutate(
        { ids, change: { folder } },
        {
          onError: fail,
          onSuccess: () =>
            toast(`${count(ids)} moved to ${FOLDER_META[folder].label}`, {
              action: from
                ? { label: "Undo", onClick: () => change.mutate({ ids, change: { folder: from } }) }
                : undefined,
            }),
        },
      );
    },

    /** Moves to Trash, undoable. */
    trash(ids: string[]) {
      remove.mutate(
        { ids },
        {
          onError: fail,
          onSuccess: () =>
            toast(`${count(ids)} moved to Trash`, {
              action: { label: "Undo", onClick: () => restore.mutate(ids) },
            }),
        },
      );
    },

    /** Deletes for good. Ask first (ConfirmDialog). */
    purge(ids: string[]) {
      return remove.mutateAsync({ ids, permanent: true });
    },

    restore(ids: string[]) {
      restore.mutate(ids, { onError: fail, onSuccess: () => toast(`${count(ids)} put back`) });
    },

    setRead(ids: string[], is_read: boolean) {
      change.mutate({ ids, change: { is_read } }, { onError: fail });
    },

    setStarred(ids: string[], is_starred: boolean) {
      change.mutate({ ids, change: { is_starred } }, { onError: fail });
    },
  };
}

/** Where Undo sends an archived or trashed thread back to. */
export function movableFolder(folder: string): Folder | undefined {
  return folder === "inbox" || folder === "archive" || folder === "spam" ? folder : undefined;
}
