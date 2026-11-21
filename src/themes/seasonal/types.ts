export interface SeasonalDatePoint {
  month: number;
  day: number;
}

export interface SeasonalThemeDefinition {
  id: string;
  /** Shown in Settings → Theme. */
  label: string;
  /** One-line summary shown next to the picker. */
  description: string;
  start: SeasonalDatePoint;
  /**
   * Inclusive end date. Ranges may wrap the new year
   * (for example December 1 → January 6).
   */
  end: SeasonalDatePoint;
  /**
   * Higher wins when two seasons overlap — Thanksgiving (30) beats
   * fall (10) for the whole of November.
   */
  priority: number;
}

export type SeasonalThemeMode = "auto" | "on" | "off";

/**
 * Per-theme surface choice. `auto` follows the app's Dark/Light setting;
 * `light` forces the cream/frosted palette; `dark` forces the deep palette.
 */
export type SeasonalPaletteMode = "auto" | "light" | "dark";

export function isWithinSeasonalDateRange(
  date: Date,
  start: SeasonalDatePoint,
  end: SeasonalDatePoint,
): boolean {
  const day = (date.getMonth() + 1) * 100 + date.getDate();
  const first = start.month * 100 + start.day;
  const last = end.month * 100 + end.day;
  return first <= last ? day >= first && day <= last : day >= first || day <= last;
}
