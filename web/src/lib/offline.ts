/**
 * Offline reading: the query cache is saved to IndexedDB on this device and
 * put back on the next start, so mail already seen opens with no connection.
 * Only mail data is kept (lists, conversations, counts, labels, mailboxes,
 * preferences, sign-in state), never settings with keys or secrets. Thread
 * actions made offline (archive, trash, star, read, labels, snooze) wait as
 * paused mutations and run when the connection comes back, even after a
 * reload. Signing out, or a 401, wipes all of it.
 */
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Mutation, Query, QueryClient } from "@tanstack/react-query";
import type { PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import { RUNTIME_CACHES } from "./offline-caches";

/** How long saved mail stays usable without a refresh. */
export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60_000;

/** Query keys (first part) that are saved for offline use. */
const KEPT = new Set([
  "auth",
  "threads",
  "thread",
  "counts",
  "labels",
  "mailboxes",
  "preferences",
  "image-trust",
]);

/** Mutation keys (first part) that wait for the network and survive a reload. */
export const QUEUED = "queued";

export function keepQuery(query: Pick<Query, "queryKey" | "state">) {
  if (query.state.status !== "success") return false;
  const [root, arg] = query.queryKey;
  if (!KEPT.has(String(root))) return false;
  // Search results are one-off: keep folder and label lists only.
  if (root === "threads" && arg && typeof arg === "object" && "q" in arg && arg.q) return false;
  return true;
}

export function keepMutation(mutation: Pick<Mutation, "options" | "state">) {
  return mutation.state.isPaused && mutation.options.mutationKey?.[0] === QUEUED;
}

const persister = createAsyncStoragePersister({
  // async: with no IndexedDB (private modes, tests) a call fails as a
  // rejected promise instead of throwing into the caller.
  storage: {
    getItem: async (key) => get<string>(key).then((value) => value ?? null),
    setItem: async (key, value: string) => set(key, value),
    removeItem: async (key) => del(key),
  },
  key: "mails-offline",
  throttleTime: 2000,
});

export function persistOptions(
  onRestored: () => void,
): Omit<PersistQueryClientProviderProps, "client" | "children"> {
  return {
    persistOptions: {
      persister,
      maxAge: OFFLINE_MAX_AGE,
      // Bump when the shape of saved data changes; old saves are dropped.
      buster: "1",
      dehydrateOptions: { shouldDehydrateQuery: keepQuery, shouldDehydrateMutation: keepMutation },
    },
    onSuccess: onRestored,
  };
}

/** Deletes every saved copy of mail on this device (IndexedDB and caches). */
export async function wipeOffline() {
  await Promise.allSettled([
    persister.removeClient(),
    ...(typeof caches === "undefined"
      ? []
      : Object.values(RUNTIME_CACHES).map((name) => caches.delete(name))),
  ]);
}

/** Forgets all mail in memory and on this device, keeping only sign-in state. */
export async function forgetMail(client: QueryClient) {
  client.getMutationCache().clear();
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
  await wipeOffline();
}
