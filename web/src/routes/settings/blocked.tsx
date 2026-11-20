import { type FormEvent, useDeferredValue, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Field,
  Icon,
  IconButton,
  Input,
  List,
  ListEmpty,
  ListRow,
  Skeleton,
  toast,
} from "@/components/kit";
import { errorMessage, useBlockAddress, useSuppressions, useUnblockAddress } from "@/lib/api";
import { EMAIL, formatDateTime } from "@/lib/mail";
import type { Suppression } from "@/lib/types";
import { LoadError } from "./parts";

/** Addresses Mails refuses to send to. */
export default function Blocked() {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const list = useSuppressions(q);
  const [unblocking, setUnblocking] = useState<Suppression | null>(null);
  const unblock = useUnblockAddress();
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];

  if (list.isError && !list.data) return <LoadError error={list.error} retry={list.refetch} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Blocked addresses</CardTitle>
          <CardDescription>
            Sending to these is refused. Addresses land here after a hard bounce or a spam
            complaint, or when you add them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-10 items-center gap-2 rounded-xl bg-field px-3">
            <Icon name="search" size={18} className="text-muted-foreground" />
            <Input
              variant="bare"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search blocked addresses"
              aria-label="Search blocked addresses"
              className="text-sm"
            />
          </div>
          <List className="bg-box">
            {list.isPending &&
              [0, 1, 2].map((i) => (
                <li key={i} className="px-3 py-3">
                  <Skeleton className="h-8" />
                </li>
              ))}
            {rows.map((row) => (
              <ListRow
                key={row.id}
                title={<span className="font-mono">{row.address}</span>}
                description={`${row.reason || "Blocked"} · ${formatDateTime(row.created_at)}`}
                action={
                  <IconButton
                    icon="delete"
                    label={`Unblock ${row.address}`}
                    onClick={() => setUnblocking(row)}
                  />
                }
              />
            ))}
            {!list.isPending && rows.length === 0 && (
              <ListEmpty>{q ? `Nothing blocked matches "${q}".` : "Nothing is blocked."}</ListEmpty>
            )}
          </List>
          {list.hasNextPage && (
            <Button
              size="sm"
              loading={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage()}
            >
              Show more
            </Button>
          )}
        </CardContent>
      </Card>
      <BlockAddress />
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

function BlockAddress() {
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const block = useBlockAddress();
  const valid = EMAIL.test(address.trim());

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    block.mutate(
      { address: address.trim(), reason: reason.trim() },
      {
        onSuccess: (row) => {
          toast.success(`${row.address} blocked`);
          setAddress("");
          setReason("");
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Block an address</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          <div>
            <Button type="submit" variant="primary" loading={block.isPending} disabled={!valid}>
              Block address
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
