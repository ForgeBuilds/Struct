export interface SeasonalThemeDefinition {
  id: string;
  start: { month: number; day: number };
  end: { month: number; day: number };
}

export type SeasonalThemeMode = "auto" | "on" | "off";

export const CHRISTMAS_THEME: SeasonalThemeDefinition = {
  id: "christmas",
  start: { month: 12, day: 1 },
  end: { month: 1, day: 6 },
};

export function isWithinSeasonalDateRange(
  date: Date,
  start: SeasonalThemeDefinition["start"],
  end: SeasonalThemeDefinition["end"],
): boolean {
  const day = (date.getMonth() + 1) * 100 + date.getDate();
  const first = start.month * 100 + start.day;
  const last = end.month * 100 + end.day;
  return first <= last ? day >= first && day <= last : day >= first || day <= last;
}
