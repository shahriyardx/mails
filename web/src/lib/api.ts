/**
 * The one place the dashboard talks to the Go server: a typed fetch wrapper,
 * query keys, and a react-query hook per resource. Screens never call fetch.
 *
 * Errors from the server are {"error", "code"} and become ApiError.
 */
import {
  type InfiniteData,
  MutationCache,
  QueryCache,
  QueryClient,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import type {
  ApiKey,
  ApiKeyInput,
  ApiKeyList,
  Attachment,
  AuthStatus,
  Contact,
  Counts,
  DeliveryFilter,
  DomainRef,
  Label,
  LiveEvent,
  LogFilter,
  LogRow,
  Mailbox,
  MessageDetail,
  Metrics,
  OutgoingMail,
  Overview,
  Page,
  Preferences,
  SendResult,
  Setup,
  Thread,
  ThreadChange,
  ThreadFilter,
  Webhook,
  WebhookDelivery,
  WebhookInput,
  WebhookPatch,
  WebhookResult,
} from "./types";

// ---- Client ---------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Calls the API. A plain object body is sent as JSON, FormData as multipart.
 * Resolves to the parsed JSON (undefined for 204), rejects with ApiError.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = "GET", body, query, signal } = init;
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(withQuery(path, query), {
      method,
      headers,
      body: payload,
      signal,
      credentials: "same-origin",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Could not reach the server. Check your connection.", 0, "network_error");
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const err = (data ?? {}) as { error?: unknown; code?: unknown };
    throw new ApiError(
      typeof err.error === "string" && err.error
        ? err.error
        : `Request failed (${response.status})`,
      response.status,
      typeof err.code === "string" ? err.code : "http_error",
    );
  }
  return data as T;
}

/** A message fit for a toast, from anything thrown. */
export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

// ---- Query client and keys ------------------------------------------------

export const keys = {
  auth: ["auth"] as const,
  threads: (filter?: ThreadFilter) =>
    filter ? (["threads", filter] as const) : (["threads"] as const),
  thread: (id?: string) => (id ? (["thread", id] as const) : (["thread"] as const)),
  counts: ["counts"] as const,
  labels: ["labels"] as const,
  mailboxes: ["mailboxes"] as const,
  contacts: (q: string) => ["contacts", q] as const,
  imageTrust: (senders: string[]) => ["image-trust", senders] as const,
  preferences: ["preferences"] as const,
  setup: ["setup"] as const,
};

/** A 401 anywhere means the session ended: re-check auth so the gate shows sign-in. */
function onError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    void queryClient.invalidateQueries({ queryKey: keys.auth });
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) =>
        count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

// ---- Auth -----------------------------------------------------------------

export function useAuthStatus() {
  return useQuery({
    queryKey: keys.auth,
    queryFn: ({ signal }) => api<AuthStatus>("/api/auth/status", { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/api/auth/sign-out", { method: "POST" }),
    onSuccess: () => {
      client.clear();
      window.location.assign("/sign-in");
    },
  });
}

// ---- Threads --------------------------------------------------------------

const PAGE_SIZE = 50;

export function useThreads(filter: ThreadFilter) {
  return useInfiniteQuery({
    queryKey: keys.threads(filter),
    queryFn: ({ pageParam, signal }) =>
      api<Page<Thread>>("/api/app/threads", {
        query: { ...filter, cursor: pageParam, limit: PAGE_SIZE },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more ? (last.next_cursor ?? undefined) : undefined),
  });
}

export function useThread(id: string | undefined) {
  return useQuery({
    queryKey: keys.thread(id),
    queryFn: ({ signal }) => api<Thread>(`/api/app/threads/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

/** Sidebar numbers, narrowed to a mailbox or domain when one is open. */
export function useCounts(scope: { mailbox?: string; domain?: string } = {}) {
  return useQuery({
    queryKey: [...keys.counts, scope],
    queryFn: ({ signal }) => api<Counts>("/api/app/counts", { query: scope, signal }),
    placeholderData: (previous) => previous,
  });
}

type ThreadPages = InfiniteData<Page<Thread>>;

/** Applies fn to every cached thread list, keeping a snapshot to roll back. */
function editLists(client: QueryClient, fn: (t: Thread) => Thread | null) {
  const snapshot = client.getQueriesData<ThreadPages>({ queryKey: keys.threads() });
  client.setQueriesData<ThreadPages>({ queryKey: keys.threads() }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            data: page.data.flatMap((t) => {
              const next = fn(t);
              return next ? [next] : [];
            }),
          })),
        }
      : data,
  );
  return () => {
    for (const [key, data] of snapshot) client.setQueryData(key, data);
  };
}

function refreshThreads(client: QueryClient, ids: string[]) {
  void client.invalidateQueries({ queryKey: keys.threads() });
  void client.invalidateQueries({ queryKey: keys.counts });
  for (const id of ids) void client.invalidateQueries({ queryKey: keys.thread(id) });
}

/**
 * Changes threads (move, read, star, labels). The lists update at once: a
 * moved thread leaves them, read/star flip in place. Rolled back on error.
 */
export function useChangeThreads() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, change }: { ids: string[]; change: ThreadChange }) =>
      api<{ ids: string[] }>("/api/app/threads", { method: "PATCH", body: { ids, ...change } }),
    onMutate: async ({ ids, change }) => {
      await client.cancelQueries({ queryKey: keys.threads() });
      const set = new Set(ids);
      return editLists(client, (t) => {
        if (!set.has(t.id)) return t;
        if (change.folder) return null;
        return {
          ...t,
          ...(change.is_read !== undefined && {
            unread_count: change.is_read ? 0 : Math.max(1, t.unread_count),
          }),
          ...(change.is_starred !== undefined && { is_starred: change.is_starred }),
        };
      });
    },
    onError: (_error, _vars, rollback) => rollback?.(),
    onSettled: (_data, _error, { ids }) => refreshThreads(client, ids),
  });
}

/** Moves threads to trash, or deletes them for good with permanent. */
export function useDeleteThreads() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, permanent = false }: { ids: string[]; permanent?: boolean }) =>
      api("/api/app/threads/delete", { method: "POST", body: { ids, permanent } }),
    onMutate: async ({ ids }) => {
      await client.cancelQueries({ queryKey: keys.threads() });
      const set = new Set(ids);
      return editLists(client, (t) => (set.has(t.id) ? null : t));
    },
    onError: (_error, _vars, rollback) => rollback?.(),
    onSettled: (_data, _error, { ids }) => refreshThreads(client, ids),
  });
}

/** Puts trashed threads back where they were. */
export function useRestoreThreads() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      api("/api/app/threads/restore", { method: "POST", body: { ids } }),
    onSettled: (_data, _error, ids) => refreshThreads(client, ids),
  });
}

export function useEmptyTrash() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (scope: { mailbox?: string; domain?: string }) =>
      api<{ threads: number }>("/api/app/trash/empty", { method: "POST", query: scope }),
    onSettled: () => refreshThreads(client, []),
  });
}

// ---- Labels, mailboxes, contacts -----------------------------------------

export function useLabels() {
  return useQuery({
    queryKey: keys.labels,
    queryFn: ({ signal }) => api<Page<Label>>("/api/app/labels", { signal }),
    select: (page) => page.data,
  });
}

export function useCreateLabel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: string }) =>
      api<Label>("/api/app/labels", { method: "POST", body: input }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.labels }),
  });
}

export function useMailboxes() {
  return useQuery({
    queryKey: keys.mailboxes,
    queryFn: ({ signal }) => api<{ data: Mailbox[] }>("/api/app/mailboxes", { signal }),
    select: (res) => res.data,
    staleTime: 5 * 60_000,
  });
}

export function useContacts(q: string) {
  return useQuery({
    queryKey: keys.contacts(q),
    queryFn: ({ signal }) =>
      api<Page<Contact>>("/api/app/contacts", { query: { q, limit: 8 }, signal }),
    select: (page) => page.data,
    enabled: q.trim().length > 0,
    staleTime: 60_000,
  });
}

// ---- Remote images -------------------------------------------------------

export function useImageTrust(senders: string[]) {
  const list = [...new Set(senders.map((s) => s.toLowerCase()))].sort();
  return useQuery({
    queryKey: keys.imageTrust(list),
    queryFn: ({ signal }) =>
      api<Record<string, boolean>>("/api/app/image-trust", {
        query: { senders: list.join(",") },
        signal,
      }),
    enabled: list.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useSetImageTrust() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { sender: string; allowed: boolean }) =>
      api<void>("/api/app/image-trust", { method: "PUT", body: input }),
    onSettled: () => client.invalidateQueries({ queryKey: ["image-trust"] }),
  });
}

// ---- Preferences, setup --------------------------------------------------

export function usePreferences() {
  return useQuery({
    queryKey: keys.preferences,
    queryFn: ({ signal }) => api<Preferences>("/api/app/preferences", { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Saves display choices, applied at once (optimistic). */
export function useSavePreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Preferences>) =>
      api<Preferences>("/api/app/preferences", { method: "PATCH", body: patch }),
    onMutate: (patch) => {
      const before = client.getQueryData<Preferences>(keys.preferences);
      if (before) client.setQueryData(keys.preferences, { ...before, ...patch });
      return before;
    },
    onError: (_error, _patch, before) => client.setQueryData(keys.preferences, before),
    onSuccess: (saved) => client.setQueryData(keys.preferences, saved),
  });
}

export function useSetup() {
  return useQuery({
    queryKey: keys.setup,
    queryFn: ({ signal }) => api<Setup>("/api/app/setup", { signal }),
    staleTime: 5 * 60_000,
  });
}

// ---- Writing mail --------------------------------------------------------

export function uploadFile(file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.append("file", file);
  return api<Attachment>("/api/app/uploads", { method: "POST", body: form, signal });
}

export function useSend() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mail: OutgoingMail) =>
      api<SendResult>("/api/app/send", { method: "POST", body: mail }),
    onSettled: (result) => refreshThreads(client, result ? [result.thread_id] : []),
  });
}

/** Creates (no draft_id) or replaces a draft. Quiet: no list refresh needed. */
export function saveDraft(mail: OutgoingMail) {
  return api<SendResult>("/api/app/drafts", { method: "POST", body: mail });
}

export function useDeleteDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/app/drafts/${id}`, { method: "DELETE" }),
    onSettled: () => refreshThreads(client, []),
  });
}

// ---- API keys, webhooks, logs, metrics, overview -------------------------

/** Domains for pickers (reach, webhook scope, metrics filter). */
export function useDomainRefs() {
  return useQuery({
    queryKey: ["domains", "refs"],
    queryFn: ({ signal }) =>
      api<{ data: DomainRef[] | null }>("/api/app/domains?light=true", { signal }),
    select: (res) => (res.data ?? []).map(({ id, name }) => ({ id, name })),
    staleTime: 5 * 60_000,
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: ({ signal }) => api<ApiKeyList>("/api/app/api-keys", { signal }),
  });
}

/** Resolves to the key and its token, the only time the token is readable. */
export function useCreateApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ApiKeyInput) =>
      api<{ key: ApiKey; token: string }>("/api/app/api-keys", { method: "POST", body: input }),
    onSettled: () => client.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRenameApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<ApiKey>(`/api/app/api-keys/${id}`, { method: "PATCH", body: { name } }),
    onSettled: () => client.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRevokeApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/app/api-keys/${id}`, { method: "DELETE" }),
    onSettled: () => client.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

/** Removes a revoked key from the list for good. */
export function usePurgeApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/app/api-keys/${id}?purge=true`, { method: "DELETE" }),
    onSettled: () => client.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useWebhooks() {
  return useQuery({
    queryKey: ["webhooks"],
    queryFn: ({ signal }) =>
      api<{ data: Webhook[]; events: string[] }>("/api/app/webhooks", { signal }),
  });
}

/** Resolves to the endpoint with its secret, shown once. */
export function useCreateWebhook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: WebhookInput) =>
      api<Webhook>("/api/app/webhooks", { method: "POST", body: input }),
    onSettled: () => client.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

/** With rotate_secret the reply carries the new secret, once. */
export function useUpdateWebhook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WebhookPatch }) =>
      api<Webhook>(`/api/app/webhooks/${id}`, { method: "PATCH", body: patch }),
    onSettled: () => client.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useDeleteWebhook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/app/webhooks/${id}`, { method: "DELETE" }),
    onSettled: () => client.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function usePingWebhook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<WebhookResult>(`/api/app/webhooks/${id}/ping`, { method: "POST" }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["webhooks"] });
      void client.invalidateQueries({ queryKey: ["webhook-deliveries"] });
    },
  });
}

export function useWebhookDeliveries(filter: DeliveryFilter) {
  return useInfiniteQuery({
    queryKey: ["webhook-deliveries", filter],
    queryFn: ({ pageParam, signal }) =>
      api<Page<WebhookDelivery>>("/api/app/webhooks/deliveries", {
        query: { ...filter, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more ? (last.next_cursor ?? undefined) : undefined),
  });
}

export function useReplayDelivery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<WebhookResult>(`/api/app/webhooks/deliveries/${id}/replay`, { method: "POST" }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["webhooks"] });
      void client.invalidateQueries({ queryKey: ["webhook-deliveries"] });
    },
  });
}

export function useLogs(filter: LogFilter) {
  return useInfiniteQuery({
    queryKey: ["logs", filter],
    queryFn: ({ pageParam, signal }) =>
      api<Page<LogRow>>("/api/app/logs", { query: { ...filter, cursor: pageParam }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more ? (last.next_cursor ?? undefined) : undefined),
    placeholderData: (previous) => previous,
  });
}

/** One message with its delivery events. */
export function useMessage(id: string | undefined) {
  return useQuery({
    queryKey: ["message", id],
    queryFn: ({ signal }) => api<MessageDetail>(`/api/app/messages/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useMetrics(range: number, domainId?: string) {
  return useQuery({
    queryKey: ["metrics", range, domainId ?? ""],
    queryFn: ({ signal }) =>
      api<Metrics>("/api/app/metrics", { query: { range, domain_id: domainId }, signal }),
    placeholderData: (previous) => previous,
  });
}

export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => api<Overview>("/api/app/overview", { signal }),
  });
}

// ---- Live updates --------------------------------------------------------

/** Which cached queries an event makes stale. Exported for tests. */
export function staleKeys(event: LiveEvent): QueryKey[] {
  const out: QueryKey[] = [keys.threads(), keys.counts];
  const ids = event.data?.thread_ids ?? (event.data?.thread_id ? [event.data.thread_id] : []);
  if (event.type === "message.updated" && ids.length === 0) out.push(keys.thread());
  for (const id of ids) out.push(keys.thread(id));
  return out;
}

/**
 * Listens on /api/events (SSE) and refetches what each event touches. After
 * a dropped connection everything is refetched, since events may be missed.
 */
export function useLiveUpdates(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events");
    let dropped = false;
    source.onopen = () => {
      if (dropped) void client.invalidateQueries();
      dropped = false;
    };
    source.onerror = () => {
      dropped = true;
    };
    source.onmessage = (message) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      for (const queryKey of staleKeys(event)) void client.invalidateQueries({ queryKey });
    };
    return () => source.close();
  }, [enabled, client]);
}
