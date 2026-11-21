import type { SeasonalThemeDefinition } from "../types";

export const CHRISTMAS_THEME: SeasonalThemeDefinition = {
  id: "christmas",
  label: "Christmas",
  description: "Deep-pine surfaces, warm gold accents, snow and hanging ornaments.",
  start: { month: 12, day: 1 },
  end: { month: 1, day: 6 },
  priority: 40,
};
