import { CHRISTMAS_THEME } from "./seasonal/christmas/config";
import { FALL_THEME } from "./seasonal/fall/config";
import { HALLOWEEN_THEME } from "./seasonal/halloween/config";
import { THANKSGIVING_THEME } from "./seasonal/thanksgiving/config";
import {
  isWithinSeasonalDateRange,
  type SeasonalDatePoint,
  type SeasonalPaletteMode,
  type SeasonalThemeDefinition,
  type SeasonalThemeMode,
} from "./seasonal/types";

export type {
  SeasonalDatePoint,
  SeasonalPaletteMode,
  SeasonalThemeDefinition,
  SeasonalThemeMode,
};

/**
 * Every seasonal theme the app knows about. Adding a theme is deliberately
 * developer-only: drop a config + CSS + effects component into a new folder,
 * then register it here and import its stylesheet from `main.tsx`.
 */
export const SEASONAL_THEMES: readonly SeasonalThemeDefinition[] = [
  CHRISTMAS_THEME,
  THANKSGIVING_THEME,
  HALLOWEEN_THEME,
  FALL_THEME,
];

export const DEFAULT_SEASONAL_THEME_ID = CHRISTMAS_THEME.id;

export function seasonalThemeById(id: string | null | undefined): SeasonalThemeDefinition | undefined {
  if (!id) return undefined;
  return SEASONAL_THEMES.find((theme) => theme.id === id);
}

/** The highest-priority theme whose date range includes `date`. */
export function seasonalThemeForDate(date = new Date()): SeasonalThemeDefinition | null {
  const matches = SEASONAL_THEMES.filter((theme) =>
    isWithinSeasonalDateRange(date, theme.start, theme.end),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, theme) => (theme.priority > best.priority ? theme : best));
}

export function resolveSeasonalTheme(
  mode: SeasonalThemeMode,
  date = new Date(),
  selectedId: string | null | undefined = DEFAULT_SEASONAL_THEME_ID,
): SeasonalThemeDefinition | null {
  if (mode === "off") return null;
  if (mode === "on") {
    return seasonalThemeById(selectedId) ?? seasonalThemeById(DEFAULT_SEASONAL_THEME_ID) ?? SEASONAL_THEMES[0] ?? null;
  }
  return seasonalThemeForDate(date);
}
