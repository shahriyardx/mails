import { type FormEvent, useDeferredValue, useState } from "react";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Icon,
  IconButton,
  Input,
  List,
  Skeleton,
  toast,
} from "@/components/kit";
import { errorMessage, useBlockAddress, useSuppressions, useUnblockAddress } from "@/lib/api";
import { EMAIL, formatDateTime } from "@/lib/mail";
import type { Suppression } from "@/lib/types";
import { emptyBox, LoadError, PageAction, rowActions } from "./parts";

/** Addresses Mails refuses to send to. */
export default function Blocked() {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const list = useSuppressions(q);
  const [adding, setAdding] = useState(false);
  const [unblocking, setUnblocking] = useState<Suppression | null>(null);
  const unblock = useUnblockAddress();
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];

  if (list.isError && !list.data) return <LoadError error={list.error} retry={list.refetch} />;

  const blockButton = (
    <Button variant="primary" icon="add" onClick={() => setAdding(true)}>
      Block address
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageAction>{blockButton}</PageAction>

      {/* Nothing to search until something is blocked. */}
      {(search || rows.length > 0) && (
        <div className="relative">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            aria-label="Search blocked addresses"
            className="pl-9"
          />
        </div>
      )}

      {list.isPending ? (
        <List aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="px-4 py-3">
              <Skeleton className="h-9" />
            </li>
          ))}
        </List>
      ) : rows.length === 0 ? (
        <div className={emptyBox}>
          <p className="text-muted-foreground">
            {q ? `Nothing blocked matches "${q}".` : "Nothing is blocked."}
          </p>
        </div>
      ) : (
        <List>
          {rows.map((row) => (
            <li
              key={row.id}
              className="group/row flex items-center gap-3 px-4 py-3 transition-colors hover:bg-box"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm font-semibold">{row.address}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {row.reason || "Blocked"} ·{" "}
                  <span className="font-mono">{formatDateTime(row.created_at)}</span>
                </div>
              </div>
              <IconButton
                icon="delete"
                size="sm"
                label={`Unblock ${row.address}`}
                className={rowActions}
                onClick={() => setUnblocking(row)}
              />
            </li>
          ))}
        </List>
      )}

      {list.hasNextPage && (
        <Button
          variant="ghost"
          className="self-center"
          loading={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
        >
          Show more
        </Button>
      )}

      <BlockDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={unblocking !== null}
        onOpenChange={(open) => !open && setUnblocking(null)}
        title="Send to this address again?"
        description={unblocking?.address}
        consequences="If it bounced before, sending to it again can hurt your SES reputation."
        confirmLabel="Unblock"
        onConfirm={async () => {
          if (!unblocking) return;
          await unblock.mutateAsync(unblocking.id);
          toast.success(`${unblocking.address} unblocked`);
        }}
      />
    </div>
  );
}

function BlockDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const block = useBlockAddress();
  const valid = EMAIL.test(address.trim());

  function close() {
    onOpenChange(false);
    setAddress("");
    setReason("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    block.mutate(
      { address: address.trim(), reason: reason.trim() },
      {
        onSuccess: (row) => {
          toast.success(`${row.address} blocked`);
          close();
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Block an address</DialogTitle>
          <DialogDescription>Mails refuses to send to it until you unblock it.</DialogDescription>
        </DialogHeader>
        <form id="block-address" className="flex flex-col gap-5" onSubmit={submit}>
          <Field label="Address" error={address && !valid ? "Not an email address" : undefined}>
            <Input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="someone@example.com"
              type="email"
              autoComplete="off"
              className="font-mono"
            />
          </Field>
          <Field label="Reason" description="Optional, for your own notes.">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              placeholder="Asked not to be mailed"
            />
          </Field>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            type="submit"
            form="block-address"
            variant="primary"
            loading={block.isPending}
            disabled={!valid}
          >
            Block address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
