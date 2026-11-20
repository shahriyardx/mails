import { useEffect, useState } from "react";

/**
 * Dark or light on <html data-theme>, from the choice in Settings ("system"
 * by default, which follows the OS live). The extension cannot read the
 * dashboard's preference with an API key, so it keeps its own.
 *
 * The choice is also copied to localStorage, which public/theme.js reads
 * before first paint (storage.local is async and would paint too late).
 */
export type ThemeChoice = "system" | "dark" | "light";
export type Theme = "dark" | "light";

const KEY = "mails-theme"; // also in public/theme.js
const media = () => window.matchMedia("(prefers-color-scheme: light)");
const systemTheme = (): Theme => (media().matches ? "light" : "dark");

/** Paints the choice and returns the resolved theme, for the mail frame. */
export function useTheme(choice: ThemeChoice | undefined): Theme {
  const [system, setSystem] = useState(systemTheme);

  useEffect(() => {
    const query = media();
    const onChange = () => setSystem(systemTheme());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved = !choice || choice === "system" ? system : choice;

  useEffect(() => {
    // Until settings load, public/theme.js has already painted the last choice.
    if (!choice) return;
    document.documentElement.dataset.theme = resolved;
    try {
      localStorage.setItem(KEY, choice);
    } catch {}
  }, [choice, resolved]);

  return resolved;
}
