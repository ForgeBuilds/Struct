import type { SeasonalThemeDefinition } from "../types";

export const HALLOWEEN_THEME: SeasonalThemeDefinition = {
  id: "halloween",
  label: "Halloween",
  description: "Pumpkin-orange glow, drifting fog, bats and a few spider webs.",
  start: { month: 10, day: 1 },
  end: { month: 10, day: 31 },
  priority: 30,
};
