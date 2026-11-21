import { Icon, toast } from "@/components/kit";
import { setAfterMove, useAfterMove } from "@/lib/after-move";
import { errorMessage, usePreferences, useSavePreferences } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";
import type { Preferences } from "@/lib/types";
import { LoadError, PageLoading, Section } from "./parts";

/** Theme, density, reading layout and what follows an archive or delete. */
export default function Appearance() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  const theme = useTheme();
  const afterMove = useAfterMove();
  if (prefs.isPending) return <PageLoading />;
  if (prefs.isError) return <LoadError error={prefs.error} retry={prefs.refetch} />;

  const change = (patch: Partial<Preferences>) =>
    save.mutate(patch, { onError: (error) => toast.error(errorMessage(error)) });

  return (
    <div className="space-y-10">
      <Section title={<span id="theme">Theme</span>}>
        <Choices
          name="theme"
          labelledBy="theme"
          value={theme.choice}
          onChange={theme.setChoice}
          columns={3}
          options={[
            { value: "system", icon: "contrast", title: "System" },
            { value: "dark", icon: "dark_mode", title: "Dark" },
            { value: "light", icon: "light_mode", title: "Light" },
          ]}
        />
      </Section>
      <Section title={<span id="density">Density</span>}>
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
              body: "Avatars and a snippet.",
            },
            {
              value: "compact",
              icon: "density_small",
              title: "Compact",
              body: "More rows on screen.",
            },
          ]}
        />
      </Section>
      <Section
        title={<span id="reading">Reading</span>}
        description="On wide screens. Phones always show one at a time."
      >
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
              body: "The list on the left, the conversation beside it.",
            },
            {
              value: "stacked",
              icon: "view_agenda",
              title: "One at a time",
              body: "The conversation takes the full width.",
            },
          ]}
        />
      </Section>
      <Section
        title={<span id="after-move">After archiving or deleting</span>}
        description="Saved in this browser."
      >
        <Choices
          name="after_move"
          labelledBy="after-move"
          value={afterMove}
          onChange={setAfterMove}
          options={[
            {
              value: "next",
              icon: "arrow_forward",
              title: "Open the next conversation",
              body: "The one below, or above at the end of the list.",
            },
            {
              value: "list",
              icon: "list_alt",
              title: "Go back to the list",
            },
          ]}
        />
      </Section>
    </div>
  );
}

/** Option tiles on native radio inputs (keyboard and screen readers for free). */
function Choices<T extends string>({
  name,
  labelledBy,
  value,
  onChange,
  options,
  columns = 2,
}: {
  name: string;
  labelledBy: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; icon: string; title: string; body?: string }[];
  columns?: 2 | 3;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={cn("grid gap-2.5", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border bg-surface p-4 outline-none transition-colors has-focus-visible:outline-2 has-focus-visible:outline-ring",
              on
                ? "border-primary shadow-[inset_0_0_0_1px_var(--primary)]"
                : "border-border hover:border-input",
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
            <Icon
              name={option.icon}
              className={cn("mt-px", on ? "text-accent" : "text-muted-foreground")}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{option.title}</span>
              {option.body && (
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  {option.body}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
