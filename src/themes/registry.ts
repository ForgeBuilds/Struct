import {
  CHRISTMAS_THEME,
  isWithinSeasonalDateRange,
  type SeasonalThemeDefinition,
  type SeasonalThemeMode,
} from "./seasonal/christmas/config";

export const SEASONAL_THEMES: readonly SeasonalThemeDefinition[] = [CHRISTMAS_THEME];

export function seasonalThemeById(id: string): SeasonalThemeDefinition | undefined {
  return SEASONAL_THEMES.find((theme) => theme.id === id);
}

export function resolveSeasonalTheme(
  mode: SeasonalThemeMode,
  date = new Date(),
): SeasonalThemeDefinition | null {
  if (mode === "off") return null;
  const christmas = seasonalThemeById("christmas");
  if (!christmas) return null;
  return mode === "on" || isWithinSeasonalDateRange(date, christmas.start, christmas.end)
    ? christmas
    : null;
}
