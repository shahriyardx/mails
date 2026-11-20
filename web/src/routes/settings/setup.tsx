import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Field, Input, List, ListRow, toast } from "@/components/kit";
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
          <FinishButton ready={remaining === 0} />
        </PageAction>
      )}

      <Section
        title="Checklist"
        description={remaining === 0 ? "Everything is in place." : undefined}
        action={
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {done}/{steps.length} done
          </span>
        }
      >
        <List>
          {steps.map((step) => (
            <Step key={step.key} step={step} />
          ))}
        </List>
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
          {/* Only finished steps are marked; the rest show their Open button. */}
          {step.done ? (
            <StatusDot tone="ok">Done</StatusDot>
          ) : (
            <span className="sr-only">To do</span>
          )}
          {step.href && (
            <Button
              size="sm"
              variant="outline"
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
    <Section title="Name this instance">
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submit}>
        <Field className="flex-1">
          <Input
            aria-label="Instance name"
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

function FinishButton({ ready }: { ready: boolean }) {
  const save = useSaveSetup();
  const navigate = useNavigate();
  return (
    <Button
      variant={ready ? "primary" : "tonal"}
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
