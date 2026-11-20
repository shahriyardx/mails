import { Link } from "react-router";
import { Button, ProgressBar, Skeleton, Stat, Stats } from "@/components/kit";
import { useOverview } from "@/lib/api";
import { formatCount } from "@/lib/reports";
import type { SesAccount } from "@/lib/types";
import { LoadError, Notice, PageAction, Section, StatusDot } from "./parts";

/** /settings/overview: the SES account's standing and what is waiting. */
export default function Overview() {
  const overview = useOverview();
  const o = overview.data;

  if (overview.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-40 rounded-[14px]" />
        <Stats>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-[14px]" />
          ))}
        </Stats>
      </div>
    );
  }
  if (overview.isError || !o) return <LoadError error={overview.error} retry={overview.refetch} />;

  return (
    <div className="space-y-10">
      <PageAction>
        <Button
          variant="outline"
          icon="refresh"
          loading={overview.isRefetching}
          onClick={() => overview.refetch()}
        >
          Refresh
        </Button>
      </PageAction>

      <Section title="Amazon SES" description="The account this instance sends through.">
        {o.account && !o.account.production_access && (
          <Notice tone="warning">
            <p className="font-medium">Your SES account is in the sandbox</p>
            <p className="text-muted-foreground">
              Amazon only lets it send to addresses and domains you have verified, with a small
              daily quota. Ask AWS for production access in the SES console before sending to anyone
              else.
            </p>
          </Notice>
        )}
        {o.account ? (
          <Account account={o.account} />
        ) : (
          <Notice tone="danger">
            <p className="font-medium">Could not reach SES</p>
            <p className="break-words">{o.error || "No answer from SES."}</p>
          </Notice>
        )}
      </Section>

      <Section title="Sending">
        <Stats>
          <Stat label="Sent today" value={formatCount(o.sent_24h)} hint="Last 24 hours" />
          <Stat label="In the queue" value={formatCount(o.queued)} hint="Waiting or sending" />
          <Stat
            label="Failed"
            value={
              <span className={o.failed_7d > 0 ? "text-destructive" : undefined}>
                {formatCount(o.failed_7d)}
              </span>
            }
            hint="Bounced, rejected or failed, 7 days"
          />
          <Stat label="Blocked" value={formatCount(o.blocked)} hint="Addresses never sent to" />
        </Stats>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["list_alt", "/settings/logs", "Logs"],
              ["monitoring", "/settings/metrics", "Metrics"],
              ["block", "/settings/blocked", "Blocked addresses"],
            ] as const
          ).map(([icon, to, text]) => (
            <Button
              key={to}
              variant="ghost"
              size="sm"
              icon={icon}
              render={<Link to={to} />}
              nativeButton={false}
            >
              {text}
            </Button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Account({ account: a }: { account: SesAccount }) {
  const used = a.max_24_hour > 0 ? Math.min(100, (a.sent_last_24_hours / a.max_24_hour) * 100) : 0;
  const healthy = a.enforcement_status.toUpperCase() === "HEALTHY";
  return (
    <div className="rounded-[14px] border border-border bg-surface">
      <div className="flex flex-wrap gap-x-5 gap-y-2 px-5 py-4">
        <StatusDot tone={a.production_access ? "ok" : "pending"}>
          {a.production_access ? "Production access" : "Sandbox"}
        </StatusDot>
        <StatusDot tone={healthy ? "ok" : "bad"}>
          {healthy ? "Healthy" : `Status: ${a.enforcement_status.toLowerCase() || "unknown"}`}
        </StatusDot>
      </div>
      {!healthy && (
        <p className="border-t border-border px-5 py-3 text-[13px] text-destructive">
          Amazon has flagged this account. Check the SES console's reputation page; sending may be
          paused until it is resolved.
        </p>
      )}
      <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="font-medium">Daily quota</span>
          <span className="font-mono tabular-nums">
            {formatCount(a.sent_last_24_hours)} / {formatCount(a.max_24_hour)}
          </span>
        </div>
        <ProgressBar value={used} label="Daily quota used" />
        <p className="text-xs text-muted-foreground">
          Up to <span className="font-mono">{formatCount(a.max_send_rate)}</span>{" "}
          {a.max_send_rate === 1 ? "message" : "messages"} a second.
        </p>
      </div>
    </div>
  );
}
