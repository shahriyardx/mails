import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Field, Input, List, ListRow, ProgressBar, toast } from "@/components/kit";
import { errorMessage, useSaveSetup, useSetup } from "@/lib/api";
import type { Setup as SetupState } from "@/lib/types";
import { LoadError, PageAction, PageLoading, Section, StatusDot } from "./parts";

/** The first-run checklist: each step links to the page that does it. */
export default function Setup() {
  const setup = useSetup();
  if (setup.isPending) return <PageLoading />;
  if (setup.isError) return <LoadError error={setup.error} retry={setup.refetch} />;
  const { steps, remaining, completed } = setup.data;
  const done = steps.length - remaining;

  return (
    <div className="space-y-10">
      {!completed && (
        <PageAction>
          <FinishButton />
        </PageAction>
      )}

      <Section
        title="Checklist"
        description={
          remaining === 0
            ? "Everything is in place. Mail can be sent and received."
            : "Each step opens the page that does it; come back here after."
        }
        action={
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {done}/{steps.length} done
          </span>
        }
      >
        <ProgressBar value={(done / Math.max(steps.length, 1)) * 100} label="Setup progress" />
        <List>
          {steps.map((step) => (
            <Step key={step.key} step={step} />
          ))}
        </List>
        <p className="text-xs text-muted-foreground">
          {completed
            ? "Setup is marked finished, so the inbox no longer shows the checklist."
            : remaining === 0
              ? "Finish setup hides the checklist from the inbox."
              : "Finish setup hides the checklist from the inbox now. The steps left stay here."}
        </p>
      </Section>

      <Brand setup={setup.data} />
    </div>
  );
}

function Step({ step }: { step: SetupState["steps"][number] }) {
  return (
    <ListRow
      title={step.title}
      action={
        <>
          <StatusDot tone={step.done ? "ok" : "pending"} className="w-14">
            {step.done ? "Done" : "To do"}
          </StatusDot>
          {step.href && (
            <Button
              size="sm"
              variant={step.done ? "ghost" : "outline"}
              render={<Link to={step.href} />}
              nativeButton={false}
              aria-label={`Open ${step.title}`}
            >
              Open
            </Button>
          )}
        </>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
    </ListRow>
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
    <Section title="Name this instance" description='Optional. Leave it empty to keep "Mails".'>
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
    </Section>
  );
}

function FinishButton() {
  const save = useSaveSetup();
  const navigate = useNavigate();
  return (
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
  );
}
