import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Icon,
  toast,
} from "@/components/kit";
import { errorMessage, usePreferences, useSavePreferences } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Preferences } from "@/lib/types";
import { LoadError, PageLoading } from "./parts";

/** Density and reading layout. Mails has one theme (soothing dark), so no theme choice. */
export default function Appearance() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  if (prefs.isPending) return <PageLoading />;
  if (prefs.isError) return <LoadError error={prefs.error} retry={prefs.refetch} />;

  const change = (patch: Partial<Preferences>) =>
    save.mutate(patch, { onError: (error) => toast.error(errorMessage(error)) });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle id="density">Density</CardTitle>
          <CardDescription>How much room each conversation takes in the list.</CardDescription>
        </CardHeader>
        <CardContent>
          <Choices
            name="density"
            labelledBy="density"
            value={prefs.data.density}
            onChange={(density) => change({ density })}
            options={[
              {
                value: "comfortable",
                icon: "density_medium",
                title: "Comfortable",
                body: "Roomier rows with larger avatars.",
              },
              {
                value: "compact",
                icon: "density_small",
                title: "Compact",
                body: "Tighter rows, so more fit on screen.",
              },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle id="reading">Reading</CardTitle>
          <CardDescription>
            Where a conversation opens on a wide screen. Narrow windows and phones always show one
            at a time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Choices
            name="reading_layout"
            labelledBy="reading"
            value={prefs.data.reading_layout}
            onChange={(reading_layout) => change({ reading_layout })}
            options={[
              {
                value: "split",
                icon: "vertical_split",
                title: "Side by side",
                body: "The list stays on the left, the conversation opens beside it.",
              },
              {
                value: "stacked",
                icon: "view_agenda",
                title: "One at a time",
                body: "The conversation takes the whole width; back returns to the list.",
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** Option cards on native radio inputs (keyboard and screen readers for free). */
function Choices<T extends string>({
  name,
  labelledBy,
  value,
  onChange,
  options,
}: {
  name: string;
  labelledBy: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; icon: string; title: string; body: string }[];
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-2xl p-4 outline-none transition-colors has-focus-visible:outline-2 has-focus-visible:outline-ring",
              on ? "bg-selected" : "bg-box hover:bg-tonal",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={on}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <Icon name={option.icon} filled={on} className="mt-0.5 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm", on ? "font-semibold" : "font-medium")}>
                {option.title}
              </span>
              <span className="block text-xs leading-relaxed text-muted-foreground">
                {option.body}
              </span>
            </span>
            {on && <Icon name="check_circle" filled size={20} />}
          </label>
        );
      })}
    </div>
  );
}
