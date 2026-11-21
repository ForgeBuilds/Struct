import FallEffects from "../../themes/seasonal/fall/FallEffects";
import HalloweenEffects from "../../themes/seasonal/halloween/HalloweenEffects";
import ThanksgivingEffects from "../../themes/seasonal/thanksgiving/ThanksgivingEffects";
import Snowfall from "../shared/Snowfall";

interface SeasonalEffectsProps {
  /** Resolved active theme id, or null when seasonal mode is off. */
  themeId?: string | null;
}

export default function SeasonalEffects({ themeId }: SeasonalEffectsProps) {
  return (
    <>
      <Snowfall />
      <FallEffects />
      <HalloweenEffects />
      <ThanksgivingEffects />
    </>
  );
}