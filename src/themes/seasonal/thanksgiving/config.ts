import type { SeasonalThemeDefinition } from "../types";

export const THANKSGIVING_THEME: SeasonalThemeDefinition = {
  id: "thanksgiving",
  label: "Thanksgiving",
  description: "Cranberry and gold, falling leaves, candlelight and wheat.",
  start: { month: 11, day: 1 },
  end: { month: 11, day: 30 },
  priority: 30,
};
