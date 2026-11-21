import FallEffects from "../../themes/seasonal/fall/FallEffects";
import HalloweenEffects from "../../themes/seasonal/halloween/HalloweenEffects";
import ThanksgivingEffects from "../../themes/seasonal/thanksgiving/ThanksgivingEffects";
import Snowfall from "../../themes/seasonal/shared/Snowfall";

interface SeasonalEffectsProps {
  /** Resolved active theme id, or null when seasonal mode is off. */
  themeId?: string | null;
}

export default function SeasonalEffects({ themeId }: SeasonalEffectsProps) {
  switch (themeId) {
    case "christmas":
      return <Snowfall />;
    case "halloween":
      return <HalloweenEffects />;
    case "fall":
      return <FallEffects />;
    case "thanksgiving":
      return <ThanksgivingEffects />;
    default:
      return null;
  }
}
