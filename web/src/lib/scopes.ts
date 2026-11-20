/**
 * The API key pickers' logic: scopes per area (None/Read/Manage), presets,
 * and reach. The catalog (areas, presets) comes from GET /api/app/api-keys,
 * so internal/apikey/scopes.go stays the one source of the names.
 */
import type { DomainRef, Mailbox, Reach, ScopeArea, ScopePreset } from "./types";

export const WILDCARD = "*";
export const CUSTOM = "custom";

export interface ScopeCatalog {
  areas: ScopeArea[];
  presets: ScopePreset[];
}

/** The highest level of an area a list of scopes reaches. */
export function levelOf(area: ScopeArea, granted: readonly string[]) {
  if (granted.includes(WILDCARD)) return area.levels.length - 1;
  for (let i = area.levels.length - 1; i > 0; i--) {
    if (area.levels[i]!.scopes.every((s) => granted.includes(s))) return i;
  }
  return 0;
}

/** The scopes a set of per-area levels adds up to. */
export function scopesForLevels(areas: ScopeArea[], levels: Record<string, number>) {
  const out = new Set<string>();
  for (const area of areas) {
    for (const s of area.levels[levels[area.id] ?? 0]?.scopes ?? []) out.add(s);
  }
  return [...out];
}

/** What "*" stands for today, written out, so a custom choice can narrow it. */
export function everyScope(areas: ScopeArea[]) {
  return scopesForLevels(areas, Object.fromEntries(areas.map((a) => [a.id, a.levels.length - 1])));
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((s) => b.includes(s));

/** The preset a list of scopes matches exactly, or "custom". */
export function presetFor(presets: ScopePreset[], scopes: readonly string[]) {
  return presets.find((p) => sameSet(p.scopes, scopes))?.id ?? CUSTOM;
}

/** What a key can do, in words. */
export function describeScopes(areas: ScopeArea[], granted: readonly string[]) {
  if (granted.includes(WILDCARD)) return "Full access";
  const parts = areas.flatMap((area) => {
    const level = levelOf(area, granted);
    if (level === 0) return [];
    return [area.levels[level]!.label === "Read" ? `${area.label} (read)` : area.label];
  });
  return parts.length ? parts.join(" · ") : "No access";
}

// ---- Scope picker state ---------------------------------------------------

export interface ScopeChoice {
  /** A preset id or "custom". */
  preset: string;
  scopes: string[];
}

export type ScopeAction =
  | { type: "preset"; id: string }
  | { type: "level"; area: string; level: number };

export function initialScopes(catalog: ScopeCatalog): ScopeChoice {
  const first = catalog.presets[0];
  return first ? { preset: first.id, scopes: first.scopes } : { preset: CUSTOM, scopes: [] };
}

/**
 * Picking a preset copies its scopes. Moving to Custom from full access
 * writes out every scope, so it starts from "everything" and is narrowed.
 * Changing one area's level names the preset it now matches, or Custom.
 */
export function nextScopes(
  state: ScopeChoice,
  action: ScopeAction,
  catalog: ScopeCatalog,
): ScopeChoice {
  if (action.type === "preset") {
    if (action.id === CUSTOM) {
      return {
        preset: CUSTOM,
        scopes: state.scopes.includes(WILDCARD) ? everyScope(catalog.areas) : state.scopes,
      };
    }
    const found = catalog.presets.find((p) => p.id === action.id);
    return found ? { preset: found.id, scopes: found.scopes } : state;
  }
  const levels = Object.fromEntries(
    catalog.areas.map((a) => [
      a.id,
      a.id === action.area ? action.level : levelOf(a, state.scopes),
    ]),
  );
  const scopes = scopesForLevels(catalog.areas, levels);
  return { preset: presetFor(catalog.presets, scopes), scopes };
}

// ---- Reach -----------------------------------------------------------------

export type ReachChoice =
  | { mode: "all" }
  | { mode: "domains"; ids: string[] }
  | { mode: "mailboxes"; ids: string[] };

/** The POST body's reach. The server takes domains or mailboxes, not both. */
export function reachBody(choice: ReachChoice) {
  return {
    domains: choice.mode === "domains" ? choice.ids : [],
    mailboxes: choice.mode === "mailboxes" ? choice.ids : [],
  };
}

/** A narrowed reach with nothing picked would be refused: say so first. */
export function reachReady(choice: ReachChoice) {
  return choice.mode === "all" || choice.ids.length > 0;
}

export function toggleId(ids: string[], id: string, on: boolean) {
  return on ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((x) => x !== id);
}

/** What a stored key reaches, in one line. */
export function describeReach(
  reach: Reach,
  domains: DomainRef[] | undefined,
  mailboxes: Mailbox[] | undefined,
) {
  const names = [
    ...(reach.domains ?? []).map(
      (id) => `all of ${domains?.find((d) => d.id === id)?.name ?? "a deleted domain"}`,
    ),
    ...(reach.mailboxes ?? []).map(
      (id) => mailboxes?.find((m) => m.id === id)?.address ?? "a deleted address",
    ),
  ];
  if (names.length === 0) return "Every mailbox";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
