import type { SeasonalThemeDefinition } from "../types";

export const FALL_THEME: SeasonalThemeDefinition = {
  id: "fall",
  label: "Autumn",
  description: "Warm amber light, drifting leaves and a soft harvest haze.",
  start: { month: 9, day: 1 },
  end: { month: 11, day: 30 },
  priority: 10,
};
