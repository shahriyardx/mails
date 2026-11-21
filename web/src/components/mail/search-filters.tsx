import { Icon, Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/kit";
import { parseSearch, SEARCH_FILTERS, termLabel, withoutTerm } from "@/lib/search";

/** The filters recognised in the search text, as chips that remove themselves. */
export function SearchChips({
  text,
  onChange,
}: {
  text: string;
  onChange: (next: string) => void;
}) {
  const { terms } = parseSearch(text);
  if (terms.length === 0) return null;
  return (
    <ul aria-label="Search filters" className="mt-2 flex flex-wrap gap-1.5">
      {terms.map((t, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: one filter can be typed twice; its place is its identity
          key={`${i}:${t.raw}`}
          className="flex items-center gap-0.5 rounded-full bg-accent-soft py-0.5 pr-0.5 pl-2.5 text-[12px] font-medium text-accent"
        >
          {termLabel(t)}
          <button
            type="button"
            aria-label={`Remove ${termLabel(t)}`}
            onClick={() => onChange(withoutTerm(text, i))}
            className="grid size-5 place-items-center rounded-full outline-none hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Icon name="close" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Filters": what the search box understands. Picking one adds it to the text. */
export function FiltersHint({ onPick }: { onPick: (filter: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            Filters
          </button>
        }
      />
      <PopoverContent align="end" className="w-76 p-1">
        <ul>
          {SEARCH_FILTERS.map((f) => {
            const op = f.example.split(":")[0]!;
            // A filter with a value of your own goes in as "from:", ready to type.
            const insert = op === "has" || op === "is" ? f.example : `${op}:`;
            return (
              <li key={f.example}>
                <PopoverClose
                  render={
                    <button
                      type="button"
                      onClick={() => onPick(insert)}
                      className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-tonal focus-visible:bg-tonal"
                    >
                      <span className="font-mono text-[12px] text-foreground">{f.example}</span>
                      <span className="text-[12px] text-muted-foreground">{f.meaning}</span>
                    </button>
                  }
                />
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
