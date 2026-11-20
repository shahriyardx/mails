import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePreferences, useSavePreferences } from "./api";
import type { ThemeChoice } from "./types";

/*
 * Dark (default) or light. The choice lives in preferences.theme on the
 * server and in localStorage, which index.html reads before first paint so
 * the page never flashes the wrong theme. <html data-theme> always holds the
 * resolved theme; "system" follows prefers-color-scheme.
 */
const KEY = "mails-theme"; // also in index.html
const BACKGROUND = { dark: "#16151a", light: "#f6f5f9" } as const; // tokens.css --background

const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: light)");

export function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "system") return value;
  } catch {}
  return "dark";
}

export function resolveTheme(choice: ThemeChoice): "dark" | "light" {
  return choice === "system" ? (media().matches ? "light" : "dark") : choice;
}

/** Remembers the choice in this browser and paints it. */
export function applyTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {}
  const resolved = resolveTheme(choice);
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BACKGROUND[resolved]);
  for (const listener of listeners) listener();
}

/** Re-paints when the system theme flips while the choice is "system". */
export function watchSystemTheme() {
  media().addEventListener("change", () => {
    if (storedTheme() === "system") applyTheme("system");
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const currentTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** The painted theme, for code that cannot use CSS tokens (the mail frame). */
export function useResolvedTheme() {
  return useSyncExternalStore(subscribe, currentTheme);
}

/**
 * The theme choice and a setter that saves it to preferences. If the server
 * does not keep `theme` (older server), localStorage still does.
 */
export function useTheme() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  const local = useSyncExternalStore(subscribe, storedTheme);
  const server = prefs.data?.theme;
  const choice = server ?? local;

  // The server's choice wins once it loads (another device may have changed it).
  useEffect(() => {
    if (server && server !== storedTheme()) applyTheme(server);
  }, [server]);

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      applyTheme(next);
      save.mutate({ theme: next });
    },
    [save],
  );

  return { choice, resolved: useResolvedTheme(), setChoice };
}
