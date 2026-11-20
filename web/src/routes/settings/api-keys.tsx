import { useState } from "react";
import { Link } from "react-router";
import { Choice } from "@/components/app/choice";
import { CodeBlock, OnceSecret } from "@/components/app/copy";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Input,
  Label,
  List,
  Skeleton,
  toast,
} from "@/components/kit";
import {
  errorMessage,
  useApiKeys,
  useCreateApiKey,
  useDomainRefs,
  useMailboxes,
  usePurgeApiKey,
  useRenameApiKey,
  useRevokeApiKey,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatStamp } from "@/lib/mail";
import {
  CUSTOM,
  describeReach,
  describeScopes,
  initialScopes,
  levelOf,
  nextScopes,
  type ReachChoice,
  reachBody,
  reachReady,
  type ScopeCatalog,
  type ScopeChoice,
  toggleId,
  WILDCARD,
} from "@/lib/scopes";
import type { ApiKey, DomainRef, Mailbox } from "@/lib/types";
import { emptyBox, LoadError, PageAction, rowActions, Section, StatusDot } from "./parts";

/** Row actions hide until the row is hovered or focused, on pointer screens. */
const ROW_ACTIONS = cn("flex shrink-0 items-center gap-0.5", rowActions);

/** /settings/api-keys: make, rename and revoke keys for the public API. */
export default function ApiKeys() {
  const keys = useApiKeys();
  const domains = useDomainRefs();
  const mailboxes = useMailboxes();
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const revoke = useRevokeApiKey();
  const purge = usePurgeApiKey();

  const list = keys.data?.data ?? [];
  const newKey = (
    <Button variant="primary" icon="add" disabled={!keys.data} onClick={() => setCreating(true)}>
      New key
    </Button>
  );

  return (
    <div className="flex flex-col gap-10">
      <PageAction>{newKey}</PageAction>

      <div className="flex flex-col gap-4">
        {fresh && (
          <OnceSecret
            title={`Your new key "${fresh.name}"`}
            value={fresh.token}
            onDismiss={() => setFresh(null)}
          />
        )}
        {keys.isPending ? (
          <List aria-busy="true">
            {[0, 1].map((i) => (
              <li key={i} className="px-4 py-3">
                <Skeleton className="h-9" />
              </li>
            ))}
          </List>
        ) : keys.isError ? (
          <LoadError error={keys.error} retry={keys.refetch} />
        ) : list.length === 0 ? (
          <div className={emptyBox}>
            <p className="text-muted-foreground">No API keys yet.</p>
          </div>
        ) : (
          <List>
            {list.map((key) => {
              const expanded = open === key.id;
              const used = key.revoked_at
                ? `revoked ${formatStamp(key.revoked_at)}`
                : key.last_used_at
                  ? `used ${formatStamp(key.last_used_at)}`
                  : "never used";
              return (
                <li key={key.id} className="group/row">
                  <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-box">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : key.id)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-ring",
                        key.revoked_at && "opacity-60",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{key.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {key.prefix}
                          {/* Open, the details below say the rest. */}
                          {!expanded &&
                            ` · ${describeScopes(keys.data.areas, key.scopes)} · ${used}`}
                        </span>
                      </span>
                      {key.revoked_at && <StatusDot tone="off">Revoked</StatusDot>}
                    </button>
                    <div className={cn(ROW_ACTIONS, expanded && "md:opacity-100")}>
                      {key.revoked_at ? (
                        <IconButton
                          icon="delete"
                          size="sm"
                          label={`Remove ${key.name} from the list`}
                          onClick={() =>
                            purge.mutate(key.id, {
                              onSuccess: () => toast.success("Key removed"),
                              onError: (error) => toast.error(errorMessage(error)),
                            })
                          }
                        />
                      ) : (
                        <>
                          <IconButton
                            icon="edit"
                            size="sm"
                            label={`Rename ${key.name}`}
                            onClick={() => setRenaming(key)}
                          />
                          <IconButton
                            icon="block"
                            size="sm"
                            label={`Revoke ${key.name}`}
                            onClick={() => setRevoking(key)}
                          />
                        </>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border px-4 py-4 text-[13px]">
                      <dt className="text-muted-foreground">May do</dt>
                      <dd>{describeScopes(keys.data.areas, key.scopes)}</dd>
                      <dt className="text-muted-foreground">May reach</dt>
                      <dd>{describeReach(key.reach, domains.data, mailboxes.data)}</dd>
                      <dt className="text-muted-foreground">Rate limit</dt>
                      <dd className="font-mono">{key.rate_limit_per_minute}/min</dd>
                      <dt className="text-muted-foreground">Created</dt>
                      <dd className="font-mono">{formatDateTime(key.created_at)}</dd>
                      <dt className="text-muted-foreground">Last used</dt>
                      <dd className="font-mono">
                        {key.last_used_at ? formatDateTime(key.last_used_at) : "never"}
                      </dd>
                      {key.revoked_at && (
                        <>
                          <dt className="text-muted-foreground">Revoked</dt>
                          <dd className="font-mono">{formatDateTime(key.revoked_at)}</dd>
                        </>
                      )}
                    </dl>
                  )}
                </li>
              );
            })}
          </List>
        )}
      </div>

      <Section
        title="Using a key"
        action={
          <Button
            size="sm"
            variant="ghost"
            icon="menu_book"
            render={<Link to="/docs/api/index" />}
            nativeButton={false}
          >
            API docs
          </Button>
        }
      >
        <CodeBlock
          text={`curl ${window.location.origin}/api/v1/me \\\n  -H "Authorization: Bearer mk_live_..."`}
        />
      </Section>

      {keys.data && (
        <CreateKeyDialog
          open={creating}
          onOpenChange={setCreating}
          catalog={keys.data}
          domains={domains.data ?? []}
          mailboxes={mailboxes.data ?? []}
          onCreated={(name, token) => setFresh({ name, token })}
        />
      )}
      <RenameDialog entry={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this key?"
        description={revoking?.name}
        consequences="Anything using it stops working at once. A revoked key cannot be turned back on; make a new one instead."
        confirmLabel="Revoke key"
        onConfirm={async () => {
          if (!revoking) return;
          await revoke.mutateAsync(revoking.id);
          toast.success("Key revoked");
        }}
      />
    </div>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  catalog,
  domains,
  mailboxes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ScopeCatalog;
  domains: DomainRef[];
  mailboxes: Mailbox[];
  onCreated: (name: string, token: string) => void;
}) {
  const create = useCreateApiKey();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ScopeChoice>(() => initialScopes(catalog));
  const [reach, setReach] = useState<ReachChoice>({ mode: "all" });
  const [rate, setRate] = useState("");

  const rateNumber = rate.trim() === "" ? undefined : Number(rate);
  const rateValid =
    rateNumber === undefined ||
    (Number.isInteger(rateNumber) && rateNumber >= 1 && rateNumber <= 100000);
  const ready = name.trim() !== "" && scopes.scopes.length > 0 && reachReady(reach) && rateValid;

  function reset() {
    setName("");
    setScopes(initialScopes(catalog));
    setReach({ mode: "all" });
    setRate("");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    create.mutate(
      {
        name: name.trim(),
        scopes: scopes.scopes,
        reach: reachBody(reach),
        rate_limit_per_minute: rateNumber,
      },
      {
        onSuccess: (result) => {
          onCreated(result.key.name, result.token);
          onOpenChange(false);
          reset();
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>The key is shown once, right after you make it.</DialogDescription>
        </DialogHeader>
        <form id="new-key" onSubmit={submit} className="flex flex-col gap-5">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Billing service"
              maxLength={100}
              required
            />
          </Field>
          <ScopePicker
            catalog={catalog}
            choice={scopes}
            onChange={(action) => setScopes((s) => nextScopes(s, action, catalog))}
          />
          <ReachPicker domains={domains} mailboxes={mailboxes} choice={reach} onChange={setReach} />
          <Field
            label="Rate limit"
            description="Requests per minute."
            error={rateValid ? undefined : "A whole number from 1 to 100000."}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="300"
              className="font-mono"
            />
          </Field>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            type="submit"
            form="new-key"
            variant="primary"
            loading={create.isPending}
            disabled={!ready}
          >
            Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A preset, or Custom with one None/Read/Manage choice per area. */
function ScopePicker({
  catalog,
  choice,
  onChange,
}: {
  catalog: ScopeCatalog;
  choice: ScopeChoice;
  onChange: (action: Parameters<typeof nextScopes>[1]) => void;
}) {
  const options = Object.fromEntries([
    ...catalog.presets.map((p) => [p.id, p.label]),
    [CUSTOM, "Custom"],
  ]);
  const hint =
    catalog.presets.find((p) => p.id === choice.preset)?.hint ??
    "Choose what the key may do in each area.";
  const full = choice.scopes.includes(WILDCARD);

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="What it may do"
        description={full ? "Everything, including what the API adds later." : hint}
      >
        <Choice
          value={choice.preset}
          onChange={(id) => onChange({ type: "preset", id })}
          options={options}
        />
      </Field>
      {!full && (
        <ul className="flex flex-col divide-y divide-border rounded-[10px] border border-border">
          {catalog.areas.map((area) => {
            const level = levelOf(area, choice.scopes);
            return (
              <li
                key={area.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <div className="text-[13px] font-medium">{area.label}</div>
                  <div className="text-xs text-muted-foreground">{area.hint}</div>
                </div>
                <fieldset className="flex shrink-0 gap-0.5 rounded-lg border border-border p-0.5">
                  <legend className="sr-only">{area.label}</legend>
                  {area.levels.map((option, index) => (
                    <label
                      key={option.label}
                      className="grid h-7 cursor-pointer place-items-center rounded-md px-3 text-xs text-muted-foreground transition-colors select-none hover:text-foreground has-checked:bg-tonal-hover has-checked:font-medium has-checked:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring"
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`area-${area.id}`}
                        checked={level === index}
                        onChange={() => onChange({ type: "level", area: area.id, level: index })}
                      />
                      {option.label}
                    </label>
                  ))}
                </fieldset>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const REACH_OPTIONS = {
  all: "Everything",
  domains: "Whole domains",
  mailboxes: "Named addresses",
};

/** Everything, whole domains (new addresses included), or named addresses. */
function ReachPicker({
  domains,
  mailboxes,
  choice,
  onChange,
}: {
  domains: DomainRef[];
  mailboxes: Mailbox[];
  choice: ReachChoice;
  onChange: (choice: ReachChoice) => void;
}) {
  const description = {
    all: "Every address on this instance, including ones added later.",
    domains: "Every address on the chosen domains, including ones added later.",
    mailboxes: "Only the chosen addresses. New addresses are not included.",
  }[choice.mode];
  const rows =
    choice.mode === "domains"
      ? domains.map((d) => ({ id: d.id, label: d.name }))
      : choice.mode === "mailboxes"
        ? mailboxes.map((m) => ({ id: m.id, label: m.address }))
        : [];

  return (
    <div className="flex flex-col gap-3">
      <Field label="What it may reach" description={description}>
        <Choice
          value={choice.mode}
          onChange={(mode) =>
            onChange(mode === "all" ? { mode: "all" } : { mode: mode as "domains", ids: [] })
          }
          options={REACH_OPTIONS}
        />
      </Field>
      {choice.mode !== "all" && (
        <fieldset className="rounded-[10px] border border-border p-1">
          <legend className="sr-only">{REACH_OPTIONS[choice.mode]}</legend>
          {rows.length === 0 ? (
            <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
              {choice.mode === "domains" ? "No domains yet." : "No addresses yet."}
            </p>
          ) : (
            rows.map((row) => (
              <Label
                key={row.id}
                className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 font-normal hover:bg-tonal"
              >
                <Checkbox
                  checked={choice.ids.includes(row.id)}
                  onCheckedChange={(on) =>
                    onChange({ ...choice, ids: toggleId(choice.ids, row.id, on) })
                  }
                />
                <span className="min-w-0 truncate font-mono text-[13px]">{row.label}</span>
              </Label>
            ))
          )}
          {choice.ids.length === 0 && rows.length > 0 && (
            <p className="px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">Pick at least one.</p>
          )}
        </fieldset>
      )}
    </div>
  );
}

function RenameDialog({ entry, onClose }: { entry: ApiKey | null; onClose: () => void }) {
  const rename = useRenameApiKey();
  const [name, setName] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (entry && loadedFor !== entry.id) {
    setLoadedFor(entry.id);
    setName(entry.name);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!entry || !name.trim()) return;
    rename.mutate(
      { id: entry.id, name: name.trim() },
      {
        onSuccess: () => {
          toast.success("Key renamed");
          setLoadedFor(null);
          onClose();
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) {
          setLoadedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename key</DialogTitle>
          <DialogDescription>
            The key itself stays the same, so nothing using it needs updating.
          </DialogDescription>
        </DialogHeader>
        <form id="rename-key" onSubmit={submit}>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            type="submit"
            form="rename-key"
            variant="primary"
            loading={rename.isPending}
            disabled={!name.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
