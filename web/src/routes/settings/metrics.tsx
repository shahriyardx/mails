import { useState } from "react";
import { Link } from "react-router";
import { Choice } from "@/components/app/choice";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  Skeleton,
  Stat,
  Stats,
  Tabs,
  TabsList,
  TabsTab,
} from "@/components/kit";
import { errorMessage, useDomainRefs, useMetrics } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  barSegments,
  formatCount,
  formatDay,
  formatRate,
  type RateLevel,
  rateLevel,
} from "@/lib/reports";
import type { Metrics as MetricsData, MetricsDay, MetricsKind } from "@/lib/types";

const ALL = "all";

/** /settings/metrics: outbound mail per day, rates against SES's limits. */
export default function Metrics() {
  const [range, setRange] = useState(30);
  const [domain, setDomain] = useState(ALL);
  const domains = useDomainRefs();
  const metrics = useMetrics(range, domain === ALL ? undefined : domain);
  const m = metrics.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={range} onValueChange={(v) => setRange(Number(v))}>
          <TabsList>
            <TabsTab value={7}>7 days</TabsTab>
            <TabsTab value={30}>30 days</TabsTab>
            <TabsTab value={90}>90 days</TabsTab>
          </TabsList>
        </Tabs>
        {(domains.data?.length ?? 0) > 1 && (
          <Choice
            label="Domain"
            value={domain}
            onChange={setDomain}
            className="w-56 max-w-full"
            options={Object.fromEntries([
              [ALL, "All domains"],
              ...(domains.data ?? []).map((d) => [d.id, d.name]),
            ])}
          />
        )}
      </div>

      {metrics.isPending ? (
        <>
          <Stats>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-3xl" />
            ))}
          </Stats>
          <Skeleton className="h-64 rounded-3xl" />
        </>
      ) : metrics.isError ? (
        <Card>
          <EmptyState
            icon="error"
            title="Could not load metrics"
            body={errorMessage(metrics.error)}
            action={<Button onClick={() => metrics.refetch()}>Try again</Button>}
          />
        </Card>
      ) : m ? (
        <Report m={m} />
      ) : null}
    </div>
  );
}

function Report({ m }: { m: MetricsData }) {
  const bounce = rateLevel("bounce", m.bounce_rate);
  const complaint = rateLevel("complaint", m.complaint_rate);

  return (
    <>
      {(bounce === "over" || complaint === "over") && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-3xl bg-destructive-soft p-4 text-destructive"
        >
          <Icon name="warning" className="mt-0.5" />
          <p className="text-[13px] leading-relaxed">
            {bounce === "over" && complaint === "over"
              ? "Your bounce and complaint rates are"
              : bounce === "over"
                ? "Your bounce rate is"
                : "Your complaint rate is"}{" "}
            past the point where Amazon SES puts an account under review (5% bounces, 0.1%
            complaints). Clean the address list and check what you send before sending more.
          </p>
        </div>
      )}

      <Stats>
        <Stat
          label="Sent"
          value={formatCount(m.totals.sent)}
          hint={`${formatRate(m.deliverability)} delivered`}
        />
        <RateStat label="Bounce rate" value={m.bounce_rate} level={bounce} limit="5%" />
        <RateStat label="Complaint rate" value={m.complaint_rate} level={complaint} limit="0.1%" />
        <Stat
          label="Open rate"
          value={formatRate(m.open_rate)}
          hint={`${formatCount(m.totals.opened)} opened`}
        />
      </Stats>

      <Card>
        <CardHeader>
          <CardTitle>Per day</CardTitle>
          <CardDescription>Outbound mail by the UTC day it was sent.</CardDescription>
        </CardHeader>
        <CardContent>
          {m.totals.sent === 0 ? (
            <EmptyState
              icon="bar_chart"
              title="Nothing sent in this range"
              body="Mail you send shows up here, one bar a day."
              className="py-10"
            />
          ) : (
            <DayChart days={m.days} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Kinds title="Bounces" empty="No bounces." kinds={m.bounces} />
        <Kinds title="Complaints" empty="No complaints." kinds={m.complaints} />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        What the rates mean, and how to bring them down:{" "}
        <Link to="/docs/guide/metrics" className="underline underline-offset-2">
          Metrics guide
        </Link>
      </p>
    </>
  );
}

function RateStat({
  label,
  value,
  level,
  limit,
}: {
  label: string;
  value: number | null;
  level: RateLevel;
  limit: string;
}) {
  return (
    <Stat
      label={label}
      value={
        <span className={cn(level === "over" && "text-destructive")}>{formatRate(value)}</span>
      }
      hint={
        level === "over"
          ? `Over the SES limit of ${limit}`
          : level === "watch"
            ? `Watch this: SES reviews at ${limit}`
            : `SES reviews at ${limit}`
      }
    />
  );
}

const SWATCH = {
  delivered: "fill-primary",
  problems: "fill-destructive",
  pending: "fill-input",
} as const;

/** Stacked bars, one a day, plain SVG. A hidden table carries the numbers. */
function DayChart({ days }: { days: MetricsDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.sent));
  const height = 100;
  const step = 10;
  const first = days[0];
  const last = days[days.length - 1];
  const middle = days[Math.floor(days.length / 2)];

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <span className="w-8 shrink-0 self-start text-right font-mono text-[11px] text-muted-foreground">
          {formatCount(max)}
        </span>
        <svg
          viewBox={`0 0 ${days.length * step} ${height}`}
          preserveAspectRatio="none"
          aria-hidden
          className="h-44 min-w-0 flex-1"
        >
          {days.map((day, i) => {
            const parts = barSegments(day);
            let y = height;
            return (
              <g key={day.day}>
                <title>
                  {`${formatDay(day.day)}: ${day.sent} sent, ${day.delivered} delivered, ${day.bounced} bounced, ${day.complained} complained`}
                </title>
                <rect
                  x={i * step}
                  y={0}
                  width={step}
                  height={height}
                  className="fill-transparent hover:fill-tonal"
                />
                {(["delivered", "problems", "pending"] as const).map((part) => {
                  const h = (parts[part] / max) * height;
                  y -= h;
                  return h > 0 ? (
                    <rect
                      key={part}
                      x={i * step + step * 0.15}
                      y={y}
                      width={step * 0.7}
                      height={h}
                      className={cn(SWATCH[part], "pointer-events-none")}
                    />
                  ) : null;
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex justify-between pl-10 text-[11px] text-muted-foreground">
        <span>{first && formatDay(first.day)}</span>
        <span className="hidden sm:inline">{middle && formatDay(middle.day)}</span>
        <span>{last && formatDay(last.day)}</span>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 pl-10 text-xs text-muted-foreground">
        <Legend className="bg-primary">Delivered</Legend>
        <Legend className="bg-destructive">Bounced or complained</Legend>
        <Legend className="bg-input">Still on its way</Legend>
      </figcaption>
      <table className="sr-only">
        <caption>Mail sent per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Sent</th>
            <th scope="col">Delivered</th>
            <th scope="col">Bounced</th>
            <th scope="col">Complained</th>
            <th scope="col">Opened</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{formatDay(d.day)}</th>
              <td>{d.sent}</td>
              <td>{d.delivered}</td>
              <td>{d.bounced}</td>
              <td>{d.complained}</td>
              <td>{d.opened}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Legend({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2.5 rounded-full", className)} />
      {children}
    </span>
  );
}

function Kinds({ title, empty, kinds }: { title: string; empty: string; kinds: MetricsKind[] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {kinds.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {kinds.map((k) => (
              <li key={k.kind} className="flex items-center gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{k.kind}</span>
                <span className="font-mono tabular-nums">{formatCount(k.count)}</span>
                <span className="w-16 text-right font-mono text-muted-foreground tabular-nums">
                  {formatRate(k.rate)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
