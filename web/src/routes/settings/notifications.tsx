import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  IconButton,
  List,
  ListEmpty,
  ListRow,
  toast,
} from "@/components/kit";
import {
  errorMessage,
  usePush,
  usePushSubscribe,
  usePushTest,
  usePushUnsubscribe,
} from "@/lib/api";
import { formatDateTime } from "@/lib/mail";
import { currentEndpoint, pushSupport, subscribeBrowser, unsubscribeBrowser } from "@/lib/push";
import { CopyValue, LoadError, Notice, PageLoading, SwitchRow } from "./parts";

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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>New mail notifications</CardTitle>
          <CardDescription>
            A notice when mail arrives, even with Mails closed. Clicking it opens the conversation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!enabled ? (
            <Notice tone="warning">
              <p>
                Push is off on this server: it has no VAPID keys. Run{" "}
                <span className="font-mono">mails vapid-keys</span>, put the two values in{" "}
                <span className="font-mono">VAPID_PUBLIC_KEY</span> and{" "}
                <span className="font-mono">VAPID_PRIVATE_KEY</span>, then restart Mails.
              </p>
              <CopyValue
                value="mails vapid-keys"
                label="Copy command"
                className="mt-2 bg-field-box"
              />
            </Notice>
          ) : support === "insecure" ? (
            <Notice tone="warning">Notifications need https. Open Mails over https.</Notice>
          ) : support === "unsupported" ? (
            <Notice tone="warning">This browser cannot show push notifications.</Notice>
          ) : permission === "denied" ? (
            <Notice tone="warning">
              Notifications are blocked for this site. Allow them in the browser's site settings,
              then come back.
            </Notice>
          ) : null}

          <div className="space-y-3 rounded-2xl bg-box p-4">
            <SwitchRow
              label={
                <span className="flex items-center gap-2">
                  Notify me on this browser
                  <Badge size="sm" tone={on ? "strong" : "neutral"}>
                    {on ? "On" : "Off"}
                  </Badge>
                </span>
              }
              description={
                on
                  ? "New mail is announced here. Other browsers and phones are set up on their own."
                  : "The browser asks for permission the first time."
              }
              checked={on}
              disabled={!usable || working}
              onCheckedChange={(next) => void (next ? turnOn() : turnOff())}
            />
            {on && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
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
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {enabled && (
        <Card>
          <CardHeader>
            <CardTitle>Browsers</CardTitle>
            <CardDescription>Every browser set up to be notified.</CardDescription>
            {browsers.length > 1 && (
              <CardAction>
                <Button size="sm" variant="ghost" onClick={() => setOffEverywhere(true)}>
                  Turn off everywhere
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <List className="bg-box">
              {browsers.map((b) => {
                const here = b.endpoint === mine;
                return (
                  <ListRow
                    key={b.id}
                    icon="notifications"
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
                        label={`Stop notifying ${b.label ?? "this browser"}`}
                        disabled={working}
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
              {browsers.length === 0 && (
                <ListEmpty>No browser is notified yet. Turn the switch above on.</ListEmpty>
              )}
            </List>
          </CardContent>
        </Card>
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
