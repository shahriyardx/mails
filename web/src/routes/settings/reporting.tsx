import { Button, toast } from "@/components/kit";
import { errorMessage, useReporting, useReportingEvents, useSetUpReporting } from "@/lib/api";
import type { ReportingStatus } from "@/lib/types";
import {
  CopyValue,
  LoadError,
  Notice,
  PageAction,
  PageLoading,
  Section,
  StatusDot,
  SwitchRow,
} from "./parts";

/** What each SES event means, in the owner's words. */
const EVENTS: Record<string, { label: string; hint: string }> = {
  SEND: { label: "Accepted", hint: "SES took the message." },
  DELIVERY: { label: "Delivered", hint: "The receiving server accepted it." },
  BOUNCE: { label: "Bounced", hint: "Refused. A permanent bounce blocks the address." },
  COMPLAINT: { label: "Marked as spam", hint: "The address is blocked at once." },
  REJECT: { label: "Rejected", hint: "SES refused to send it." },
  DELIVERY_DELAY: { label: "Delayed", hint: "Still being retried, not a failure yet." },
  RENDERING_FAILURE: { label: "Render failure", hint: "SES could not build the message." },
  OPEN: { label: "Opens", hint: "Adds an invisible image to every HTML message." },
  CLICK: { label: "Clicks", hint: "Rewrites every link to go through AWS first." },
};

/** /settings/reporting: SES delivery reports, set up in one click. */
export default function Reporting() {
  const status = useReporting();
  const setUp = useSetUpReporting();

  if (status.isPending) return <PageLoading />;
  if (status.isError) return <LoadError error={status.error} retry={status.refetch} />;
  const st = status.data;

  const runSetUp = () =>
    setUp.mutate(undefined, {
      onSuccess: (next) =>
        toast.success(
          next.subscription === "confirmed"
            ? "Reporting is on."
            : "Set up. AWS is confirming the subscription; refresh in a moment.",
        ),
      onError: (error) => toast.error(errorMessage(error)),
    });

  return (
    <div className="space-y-10">
      <PageAction>
        <Button
          variant="outline"
          icon="refresh"
          onClick={() => status.refetch()}
          loading={status.isRefetching}
        >
          Check again
        </Button>
        <Button
          variant="primary"
          onClick={runSetUp}
          loading={setUp.isPending}
          icon={st.active ? "sync" : "bar_chart"}
        >
          {st.active ? "Repair" : "Set up reporting"}
        </Button>
      </PageAction>

      <Section
        title="Delivery reports"
        description="Without them Mails knows a message left, but not whether it arrived, bounced or was marked as spam, and bounced addresses are never blocked."
      >
        {st.error && <Notice tone="danger">{st.error}</Notice>}
        <Steps st={st} />
        <CopyValue value={st.endpoint} label="Copy the events endpoint" />
        {st.env_managed && (
          <Notice>
            SES_CONFIGURATION_SET or SES_SNS_TOPIC_ARN is set in the environment, and those win over
            what is set up here.
          </Notice>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Setting up creates an SNS topic only SES in your account may publish to, a configuration
          set named <span className="font-mono">{st.name}</span>, and a subscription that calls this
          app. The app must be reachable on a public https address.
        </p>
      </Section>

      {st.destination && <EventChoices st={st} />}
    </div>
  );
}

function Steps({ st }: { st: ReportingStatus }) {
  const rows: { label: string; done: boolean; waiting?: boolean; detail: string }[] = [
    { label: "Configuration set", done: st.configuration_set, detail: st.name },
    { label: "Events go to SNS", done: st.destination, detail: st.topic_arn || "No topic yet" },
    {
      label: "Subscription",
      done: st.subscription === "confirmed",
      waiting: st.subscription === "pending",
      detail:
        st.subscription === "pending"
          ? "Waiting for AWS to confirm"
          : st.subscription === "confirmed"
            ? "Confirmed"
            : "Not subscribed",
    },
    {
      label: "Used by this app",
      done: st.active,
      detail: st.active ? "Sending with it" : "Not yet",
    },
  ];
  return (
    <ul className="divide-y divide-border rounded-[14px] border border-border bg-surface">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{row.label}</span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {row.detail}
            </span>
          </span>
          <StatusDot tone={row.done ? "ok" : row.waiting ? "pending" : "off"}>
            {row.done ? "Done" : row.waiting ? "Waiting" : "Missing"}
          </StatusDot>
        </li>
      ))}
    </ul>
  );
}

function EventChoices({ st }: { st: ReportingStatus }) {
  const save = useReportingEvents();
  const toggle = (type: string, on: boolean) => {
    const optional = st.types.filter((t) => st.optional.includes(t) && t !== type);
    save.mutate(on ? [...optional, type] : optional, {
      onError: (error) => toast.error(errorMessage(error)),
    });
  };
  return (
    <Section title="What SES reports" description="The first five are always on: Mails needs them.">
      <ul className="divide-y divide-border rounded-[14px] border border-border bg-surface">
        {[...st.required, ...st.optional].map((type) => (
          <li key={type} className="px-4 py-3">
            <SwitchRow
              label={EVENTS[type]?.label ?? type}
              description={EVENTS[type]?.hint}
              checked={st.types.includes(type)}
              disabled={st.required.includes(type) || save.isPending}
              onCheckedChange={(on) => toggle(type, on)}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}
