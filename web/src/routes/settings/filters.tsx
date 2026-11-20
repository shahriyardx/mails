import { type FormEvent, useState } from "react";
import { Choice } from "@/components/app/choice";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Input,
  List,
  ListRow,
  Switch,
  toast,
} from "@/components/kit";
import { errorMessage, useDeleteFilter, useFilters, useLabels, useSaveFilter } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  describeFilter,
  emptyFilterForm,
  type FilterErrors,
  type FilterForm,
  formFromFilter,
  validateFilter,
} from "@/lib/settings";
import type { Filter, FilterInput } from "@/lib/types";
import { emptyBox, LoadError, PageAction, PageLoading, rowActions } from "./parts";

/** Rules run on each inbound message before it lands. */
export default function Filters() {
  const filters = useFilters();
  const labels = useLabels();
  const [editing, setEditing] = useState<Filter | "new" | null>(null);

  if (filters.isPending) return <PageLoading />;
  if (filters.isError) return <LoadError error={filters.error} retry={filters.refetch} />;
  const add = () => setEditing("new");

  return (
    <div className="space-y-4">
      <PageAction>
        <Button variant="primary" icon="add" onClick={add}>
          New filter
        </Button>
      </PageAction>
      {filters.data.length === 0 ? (
        <div className={emptyBox}>
          <p className="text-muted-foreground">
            No filters yet. New mail lands in the inbox as it is.
          </p>
          <Button variant="primary" icon="add" className="mt-4" onClick={add}>
            New filter
          </Button>
        </div>
      ) : (
        <List>
          {filters.data.map((filter) => (
            <FilterRow
              key={filter.id}
              filter={filter}
              description={describeFilter(filter, labels.data)}
              onEdit={() => setEditing(filter)}
            />
          ))}
        </List>
      )}
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        A filter matches when each condition it sets is found in that field, ignoring case. Higher
        priority runs first: the first match picks the folder; labels, read and star add up.
      </p>
      <FilterDialog filter={editing} onClose={() => setEditing(null)} labels={labels.data ?? []} />
    </div>
  );
}

function FilterRow({
  filter,
  description,
  onEdit,
}: {
  filter: Filter;
  description: string;
  onEdit: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const save = useSaveFilter();
  const remove = useDeleteFilter();
  const { id, created_at: _, ...input } = filter;

  return (
    <ListRow
      className="relative"
      title={
        // The name is the row's main button; its ::after stretches over the row.
        <button
          type="button"
          onClick={onEdit}
          className="flex w-full min-w-0 items-center gap-2.5 text-left outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
        >
          <span className="truncate">{filter.name}</span>
          {filter.priority !== 0 && (
            <span className="font-mono text-xs font-normal text-muted-foreground">
              priority {filter.priority}
            </span>
          )}
        </button>
      }
      description={<span className="whitespace-normal break-words">{description}</span>}
      action={
        <div className="relative flex items-center gap-1">
          <Switch
            checked={filter.enabled}
            aria-label={`${filter.name} enabled`}
            className="mr-1"
            onCheckedChange={(enabled) =>
              save.mutate(
                { id, input: { ...input, enabled } },
                { onError: (error) => toast.error(errorMessage(error)) },
              )
            }
          />
          <div className={cn("flex items-center gap-1", rowActions)}>
            <IconButton icon="edit" size="sm" label={`Edit ${filter.name}`} onClick={onEdit} />
            <IconButton
              icon="delete"
              size="sm"
              label={`Delete ${filter.name}`}
              onClick={() => setDeleting(true)}
            />
          </div>
        </div>
      }
    >
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the filter ${filter.name}?`}
        consequences="Mail that already arrived stays where the filter put it."
        confirmLabel="Delete filter"
        onConfirm={async () => {
          await remove.mutateAsync(id);
          toast.success("Filter deleted");
        }}
      />
    </ListRow>
  );
}

const FOLDERS = {
  "": "Leave where it lands",
  inbox: "Keep in inbox",
  archive: "Archive",
  spam: "Mark as spam",
  trash: "Move to trash",
};

function FilterDialog({
  filter,
  onClose,
  labels,
}: {
  filter: Filter | "new" | null;
  onClose: () => void;
  labels: { id: string; name: string }[];
}) {
  const [form, setForm] = useState<FilterForm>(emptyFilterForm);
  const [errors, setErrors] = useState<FilterErrors>({});
  const [shown, setShown] = useState<typeof filter>(null);
  // Load the form each time the dialog opens on a filter.
  if (filter !== shown) {
    setShown(filter);
    if (filter) {
      setForm(filter === "new" ? emptyFilterForm : formFromFilter(filter));
      setErrors({});
    }
  }
  const save = useSaveFilter();
  const set = <K extends keyof FilterForm>(key: K, value: FilterForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateFilter(form);
    setErrors(result.errors);
    if (!result.input) return;
    const input: FilterInput = result.input;
    save.mutate(
      { id: filter && filter !== "new" ? filter.id : undefined, input },
      {
        onSuccess: () => {
          toast.success(filter === "new" ? "Filter added" : "Filter saved");
          onClose();
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  const labelItems = { "": "No label", ...Object.fromEntries(labels.map((l) => [l.id, l.name])) };

  return (
    <Dialog open={filter !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{filter === "new" ? "New filter" : "Edit filter"}</DialogTitle>
          <DialogDescription>
            Leave a condition empty to ignore that field. At least one is needed.
          </DialogDescription>
        </DialogHeader>
        <form id="filter-form" className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <Field label="Name" error={errors.name}>
              <Input
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="Newsletters"
              />
            </Field>
            <Field label="Priority" error={errors.priority}>
              <Input
                value={form.priority}
                onChange={(event) => set("priority", event.target.value)}
                inputMode="numeric"
                className="font-mono"
              />
            </Field>
          </div>

          <fieldset className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <legend className="float-left mb-1 text-sm font-semibold sm:col-span-2">
              When the message
            </legend>
            <Field label="From contains">
              <Input
                value={form.match_from}
                onChange={(event) => set("match_from", event.target.value)}
                placeholder="@substack.com"
                className="font-mono"
              />
            </Field>
            <Field label="To contains">
              <Input
                value={form.match_to}
                onChange={(event) => set("match_to", event.target.value)}
                placeholder="news@"
                className="font-mono"
              />
            </Field>
            <Field label="Subject contains">
              <Input
                value={form.match_subject}
                onChange={(event) => set("match_subject", event.target.value)}
                placeholder="invoice"
              />
            </Field>
            <Field label="Body contains">
              <Input
                value={form.match_body}
                onChange={(event) => set("match_body", event.target.value)}
                placeholder="unsubscribe"
              />
            </Field>
            {errors.match && (
              <p role="alert" className="text-xs text-destructive sm:col-span-2">
                {errors.match}
              </p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
            <legend className="float-left mb-1 text-sm font-semibold">Then</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Folder">
                <Choice
                  options={FOLDERS}
                  value={form.action_folder}
                  onChange={(v) => set("action_folder", v as FilterForm["action_folder"])}
                />
              </Field>
              <Field label="Label">
                <Choice
                  options={labelItems}
                  value={form.action_label_id}
                  onChange={(v) => set("action_label_id", v)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <CheckOption
                label="Mark as read"
                checked={form.action_mark_read}
                onChange={(on) => set("action_mark_read", on)}
              />
              <CheckOption
                label="Star"
                checked={form.action_star}
                onChange={(on) => set("action_star", on)}
              />
              <CheckOption
                label="Enabled"
                checked={form.enabled}
                onChange={(on) => set("enabled", on)}
              />
            </div>
            {errors.action && (
              <p role="alert" className="text-xs text-destructive">
                {errors.action}
              </p>
            )}
          </fieldset>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button type="submit" form="filter-form" variant="primary" loading={save.isPending}>
            {filter === "new" ? "Add filter" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckOption({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Base UI checkbox inside is the control
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
      <Checkbox checked={checked} onCheckedChange={(on) => onChange(on === true)} />
      {label}
    </label>
  );
}
