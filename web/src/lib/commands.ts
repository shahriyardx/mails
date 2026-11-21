/** One entry in the command menu (Ctrl+K). */
export interface Command {
  id: string;
  label: string;
  /** What kind it is, shown on the right: "Folder", "Settings", "Action"... */
  hint: string;
  icon: string;
  /** More words it answers to ("compose" for Write message). */
  keywords?: string;
  run: () => void;
}

const WORD_START = /[\s\-_./@·]/;

/**
 * How well `query` matches `text`, case-insensitive: 100 equal, 80 prefix,
 * 60 at a word start, 40 anywhere, then 1-20 for the letters in order
 * (fuzzy; fewer letters skipped in between score higher). 0 is no match.
 */
export function matchScore(text: string, query: string) {
  const t = text.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const at = t.indexOf(q);
  if (at > 0 && WORD_START.test(t[at - 1]!)) return 60;
  if (at > 0) return 40;
  let first = -1;
  let last = -1;
  for (const char of q) {
    last = t.indexOf(char, last + 1);
    if (last < 0) return 0;
    if (first < 0) first = last;
  }
  // Letters skipped between the first and the last matched one.
  return Math.max(1, 20 - (last - first + 1 - q.length));
}

/**
 * The commands matching `query`, best first; equal scores keep their
 * order. The label counts most (fuzzy); a command is also found when every
 * word of the query is in its kind, label or keywords ("set dom" finds
 * Settings / Domains), ranked below good label matches. An empty query
 * keeps every command in order.
 */
export function rankCommands<T extends Command>(commands: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...commands];
  return commands
    .map((command, index) => {
      const text = `${command.hint} ${command.label} ${command.keywords ?? ""}`.toLowerCase();
      const byWords = words.every((word) => text.includes(word)) ? 30 : 0;
      return { command, index, score: Math.max(matchScore(command.label, query) * 2, byWords) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}
