import { IconButton, Tooltip } from "@/components/kit";
import { useTheme } from "@/lib/theme";

/** Flips between dark and light; saved to preferences (Settings -> Appearance has System too). */
export function ThemeToggle() {
  const { resolved, setChoice } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  const label = `Switch to ${next} theme`;
  return (
    <Tooltip label={label}>
      <IconButton
        icon={next === "light" ? "light_mode" : "dark_mode"}
        label={label}
        variant="outline"
        size="xs"
        onClick={() => setChoice(next)}
      />
    </Tooltip>
  );
}
