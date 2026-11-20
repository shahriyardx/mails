import { Link } from "react-router";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  IconButton,
  ProgressBar,
  Skeleton,
  Stat,
  Stats,
} from "@/components/kit";
import { errorMessage, useOverview } from "@/lib/api";
import { formatCount } from "@/lib/reports";
import type { SesAccount } from "@/lib/types";

/** /settings/overview: the SES account's standing and what is waiting. */
export default function Overview() {
  const overview = useOverview();
  const o = overview.data;

  if (overview.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-44 rounded-3xl" />
        <Stats>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-3xl" />
          ))}
        </Stats>
      </div>
    );
  }
  if (overview.isError || !o) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Could not load the overview"
          body={errorMessage(overview.error)}
          action={<Button onClick={() => overview.refetch()}>Try again</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {o.account && !o.account.production_access && (
        <div role="alert" className="flex items-start gap-3 rounded-3xl bg-box p-4">
          <Icon name="warning" className="mt-0.5" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium">Your SES account is in the sandbox</p>
            <p className="text-muted-foreground">
              Amazon only lets it send to addresses and domains you have verified, with a small
              daily quota. Ask AWS for production access in the SES console before sending to anyone
              else.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Amazon SES</CardTitle>
          <CardDescription>The account this instance sends through.</CardDescription>
          <CardAction>
            <IconButton
              icon="refresh"
              label="Refresh"
              loading={overview.isRefetching}
              onClick={() => overview.refetch()}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          {o.account ? (
            <Account account={o.account} />
          ) : (
            <div className="flex items-start gap-3 rounded-2xl bg-destructive-soft p-4 text-destructive">
              <Icon name="error" className="mt-0.5" />
              <div className="min-w-0 text-[13px]">
                <p className="font-medium">Could not reach SES</p>
                <p className="break-words">{o.error || "No answer from SES."}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
        <Button icon="list_alt" render={<Link to="/settings/logs" />} nativeButton={false}>
          Logs
        </Button>
        <Button icon="monitoring" render={<Link to="/settings/metrics" />} nativeButton={false}>
          Metrics
        </Button>
        <Button icon="block" render={<Link to="/settings/blocked" />} nativeButton={false}>
          Blocked addresses
        </Button>
      </div>
    </div>
  );
}

function Account({ account: a }: { account: SesAccount }) {
  const used = a.max_24_hour > 0 ? Math.min(100, (a.sent_last_24_hours / a.max_24_hour) * 100) : 0;
  const healthy = a.enforcement_status.toUpperCase() === "HEALTHY";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Badge tone={a.production_access ? "strong" : "neutral"}>
          {a.production_access ? "Production access" : "Sandbox"}
        </Badge>
        <Badge tone={healthy ? "neutral" : "danger"}>
          {healthy ? "Healthy" : `Status: ${a.enforcement_status.toLowerCase() || "unknown"}`}
        </Badge>
      </div>
      {!healthy && (
        <p className="text-[13px] text-destructive">
          Amazon has flagged this account. Check the SES console's reputation page; sending may be
          paused until it is resolved.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span>Daily quota</span>
          <span className="font-mono tabular-nums">
            {formatCount(a.sent_last_24_hours)} / {formatCount(a.max_24_hour)}
          </span>
        </div>
        <ProgressBar value={used} label="Daily quota used" />
        <p className="text-xs text-muted-foreground">
          Up to {formatCount(a.max_send_rate)} {a.max_send_rate === 1 ? "message" : "messages"} a
          second.
        </p>
      </div>
    </div>
  );
}
