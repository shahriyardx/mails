import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Icon,
  Input,
  ProgressBar,
  toast,
} from "@/components/kit";
import { errorMessage, useSaveSetup, useSetup } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Setup as SetupState } from "@/lib/types";
import { LoadError, PageLoading } from "./parts";

/** The first-run checklist: each step links to the page that does it. */
export default function Setup() {
  const setup = useSetup();
  if (setup.isPending) return <PageLoading />;
  if (setup.isError) return <LoadError error={setup.error} retry={setup.refetch} />;
  const { steps, remaining, completed } = setup.data;
  const done = steps.length - remaining;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Set up Mails</CardTitle>
          <CardDescription>
            {remaining === 0
              ? "Everything is in place. Mail can be sent and received."
              : `${done} of ${steps.length} done. Each step opens the page that does it; come back here after.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProgressBar value={(done / Math.max(steps.length, 1)) * 100} label="Setup progress" />
          <ol className="space-y-1.5">
            {steps.map((step, i) => (
              <li key={step.key}>
                <Step index={i + 1} step={step} />
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Brand setup={setup.data} />
      <Finish completed={completed} remaining={remaining} />
    </div>
  );
}

function Step({ index, step }: { index: number; step: SetupState["steps"][number] }) {
  const body = (
    <>
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full font-mono text-[13px]",
          step.done ? "bg-primary text-primary-foreground" : "bg-tonal text-muted-foreground",
        )}
      >
        {step.done ? <Icon name="check" size={18} /> : index}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{step.title}</span>
        <span className="block text-xs leading-relaxed text-muted-foreground">{step.detail}</span>
      </span>
      {step.done ? (
        <Badge size="sm">Done</Badge>
      ) : (
        step.href && <Icon name="chevron_right" className="text-muted-foreground" />
      )}
    </>
  );
  const row = "flex items-center gap-3 rounded-2xl bg-box px-3.5 py-3";
  return step.href ? (
    <Link
      to={step.href}
      className={cn(
        row,
        "outline-none hover:bg-tonal focus-visible:outline-2 focus-visible:outline-ring",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={row}>{body}</div>
  );
}

function Brand({ setup }: { setup: SetupState }) {
  const [name, setName] = useState(setup.brand_name ?? "");
  const save = useSaveSetup();
  const changed = name.trim() !== (setup.brand_name ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      { brand_name: name.trim() },
      {
        onSuccess: () => toast.success(name.trim() ? "Name saved" : "Name cleared"),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Name this instance</CardTitle>
        <CardDescription>Optional. Leave it empty to keep "Mails".</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submit}>
          <Field label="Name" className="flex-1">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Mails"
              maxLength={60}
            />
          </Field>
          <Button type="submit" loading={save.isPending} disabled={!changed}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Finish({ completed, remaining }: { completed: boolean; remaining: number }) {
  const save = useSaveSetup();
  const navigate = useNavigate();
  if (completed) {
    return (
      <p className="px-2 text-xs text-muted-foreground">
        Setup is marked finished, so the inbox no longer shows the checklist.
      </p>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Finish</CardTitle>
        <CardDescription>
          {remaining === 0
            ? "Hide the checklist from the inbox."
            : "Hide the checklist from the inbox now. The steps left stay here."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="primary"
          icon="done_all"
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              { completed: true },
              {
                onSuccess: () => {
                  toast.success("Setup finished");
                  navigate("/mail/all/inbox");
                },
                onError: (error) => toast.error(errorMessage(error)),
              },
            )
          }
        >
          Finish setup
        </Button>
      </CardContent>
    </Card>
  );
}
