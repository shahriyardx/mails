import { useEffect, useState } from "react";
import { Badge, Button, ConfirmDialog, IconButton, List, ListRow, toast } from "@/components/kit";
import {
  errorMessage,
  usePush,
  usePushSubscribe,
  usePushTest,
  usePushUnsubscribe,
} from "@/lib/api";
import { formatDateTime } from "@/lib/mail";
import { currentEndpoint, pushSupport, subscribeBrowser, unsubscribeBrowser } from "@/lib/push";
import {
  CopyValue,
  DangerRow,
  DangerZone,
  emptyBox,
  LoadError,
  Notice,
  PageAction,
  PageLoading,
  rowActions,
  Section,
  SwitchRow,
} from "./parts";

/** Web push for new mail, switched on per browser. */
export default function Notifications() {
  const push = usePush();
  const subscribe = usePushSubscribe();
  const unsubscribe = usePushUnsubscribe();
  const test = usePushTest();
  const [support] = useState(pushSupport);
  const [mine, setMine] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [offEverywhere, setOffEverywhere] = useState(false);
  const permission = support === "ready" ? Notification.permission : "default";

  useEffect(() => {
    currentEndpoint().then(setMine, () => setMine(null));
  }, []);

  if (push.isPending) return <PageLoading />;
  if (push.isError) return <LoadError error={push.error} retry={push.refetch} />;
  const { enabled, public_key, browsers } = push.data;
  const on = Boolean(mine && browsers.some((b) => b.endpoint === mine));
  const usable = enabled && support === "ready" && permission !== "denied";

  async function turnOn() {
    setWorking(true);
    try {
      const sub = await subscribeBrowser(public_key);
      await subscribe.mutateAsync(sub);
      setMine(sub.endpoint);
      toast.success("Notifications are on for this browser");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function turnOff() {
    setWorking(true);
    try {
      const endpoint = (await unsubscribeBrowser()) ?? mine;
      // Never send an empty endpoint here: the server reads that as "all".
      if (endpoint) await unsubscribe.mutateAsync(endpoint);
      setMine(null);
      toast.success("Notifications are off for this browser");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-10">
      {on && (
        <PageAction>
          <Button
            icon="send"
            loading={test.isPending}
            onClick={() =>
              test.mutate(undefined, {
                onSuccess: ({ delivered }) =>
                  delivered > 0
                    ? toast.success(
                        `Test sent to ${delivered} browser${delivered === 1 ? "" : "s"}. Nothing showed? The OS may be hiding it.`,
                      )
                    : toast.error(
                        "No browser accepted the test. Turn notifications on again here.",
                      ),
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            Send a test
          </Button>
        </PageAction>
      )}

      <div className="space-y-3">
        {!enabled ? (
          <Notice tone="warning">
            <p>
              Push is off on this server: it has no VAPID keys. Run{" "}
              <span className="font-mono">mails vapid-keys</span>, put the two values in{" "}
              <span className="font-mono">VAPID_PUBLIC_KEY</span> and{" "}
              <span className="font-mono">VAPID_PRIVATE_KEY</span>, then restart Mails.
            </p>
            <CopyValue value="mails vapid-keys" label="Copy command" className="mt-2" />
          </Notice>
        ) : support === "insecure" ? (
          <Notice tone="warning">Notifications need https. Open Mails over https.</Notice>
        ) : support === "home-screen" ? (
          <Notice tone="warning">
            On iPhone and iPad, notifications work only in the installed app. In Safari, tap Share,
            then Add to Home Screen. Open Mails from the Home Screen and turn this on there.
          </Notice>
        ) : support === "unsupported" ? (
          <Notice tone="warning">This browser cannot show push notifications.</Notice>
        ) : permission === "denied" ? (
          <Notice tone="warning">
            Notifications are blocked for this site. Allow them in the browser's site settings, then
            come back.
          </Notice>
        ) : null}

        <div className="rounded-[14px] border border-border bg-surface p-4">
          <SwitchRow
            label="Notify me on this browser"
            checked={on}
            disabled={!usable || working}
            onCheckedChange={(next) => void (next ? turnOn() : turnOff())}
          />
        </div>
      </div>

      {enabled && (
        <Section title="All browsers">
          {browsers.length === 0 ? (
            <div className={emptyBox}>
              <p className="text-muted-foreground">No browser is notified yet.</p>
            </div>
          ) : (
            <List>
              {browsers.map((b) => {
                const here = b.endpoint === mine;
                return (
                  <ListRow
                    key={b.id}
                    title={
                      <span className="flex items-center gap-2">
                        <span className="truncate">{b.label ?? "A browser"}</span>
                        {here && <Badge size="sm">This one</Badge>}
                      </span>
                    }
                    description={`Added ${formatDateTime(b.created_at)}`}
                    action={
                      <IconButton
                        icon="close"
                        size="sm"
                        label={`Stop notifying ${b.label ?? "this browser"}`}
                        disabled={working}
                        className={rowActions}
                        onClick={() =>
                          here
                            ? void turnOff()
                            : unsubscribe.mutate(b.endpoint, {
                                onSuccess: () =>
                                  toast.success("That browser is no longer notified"),
                                onError: (error) => toast.error(errorMessage(error)),
                              })
                        }
                      />
                    }
                  />
                );
              })}
            </List>
          )}
        </Section>
      )}

      {enabled && browsers.length > 1 && (
        <DangerZone>
          <DangerRow
            title="Turn off everywhere"
            description="Every browser and phone stops being notified."
            action={
              <Button variant="destructive" onClick={() => setOffEverywhere(true)}>
                Turn off everywhere
              </Button>
            }
          />
        </DangerZone>
      )}

      <ConfirmDialog
        open={offEverywhere}
        onOpenChange={setOffEverywhere}
        title="Turn notifications off everywhere?"
        consequences="Every browser stops being notified. Each one can be turned on again from its own settings page."
        confirmLabel="Turn off everywhere"
        onConfirm={async () => {
          await unbrowse();
          await unsubscribe.mutateAsync({ all: true });
          setMine(null);
          toast.success("Notifications are off everywhere");
        }}
      />
    </div>
  );
}

/** Drops this browser's own subscription too, ignoring a browser that has none. */
async function unbrowse() {
  if (pushSupport() === "ready") await unsubscribeBrowser().catch(() => null);
}
