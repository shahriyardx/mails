import { Link } from "react-router";
import { Icon, ProgressBar } from "@/components/kit";
import { useSetup } from "@/lib/api";
import { cn } from "@/lib/cn";

/** What is left before mail flows, shown on the inbox until it is done. */
export function SetupCard() {
  const setup = useSetup();
  if (!setup.data || setup.data.completed || setup.data.remaining === 0) return null;
  const { steps, remaining } = setup.data;
  const done = steps.length - remaining;

  return (
    <section aria-label="Finish setting up" className="mx-2 mb-2 rounded-3xl bg-box p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Finish setting up</h2>
        <span className="text-xs text-muted-foreground">
          {done} of {steps.length} done
        </span>
      </div>
      <ProgressBar value={(done / steps.length) * 100} label="Setup progress" className="mb-3" />
      <ol className="space-y-0.5">
        {steps.map((step) => {
          const body = (
            <>
              <Icon
                name={step.done ? "check_circle" : "circle"}
                filled={step.done}
                size={20}
                className={step.done ? "text-foreground" : "text-muted-foreground"}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-[13px] font-medium",
                    step.done && "text-muted-foreground line-through",
                  )}
                >
                  {step.title}
                </span>
                {!step.done && (
                  <span className="block text-xs text-muted-foreground">{step.detail}</span>
                )}
              </span>
              {step.href && !step.done && (
                <Icon name="chevron_right" size={18} className="text-muted-foreground" />
              )}
            </>
          );
          const row = "flex items-center gap-3 rounded-2xl px-2 py-2";
          return (
            <li key={step.key}>
              {step.href && !step.done ? (
                <Link to={step.href} className={cn(row, "hover:bg-tonal")}>
                  {body}
                </Link>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
