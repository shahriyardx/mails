// Paints the saved theme before first paint, so a light page never flashes
// dark. A file because MV3 pages refuse inline scripts. lib/theme.ts writes
// the same key from the choice in Settings; keep the two in step.
try {
  var c = localStorage.getItem("mails-theme");
  document.documentElement.dataset.theme =
    c === "light" || c === "dark"
      ? c
      : matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
} catch (e) {}
