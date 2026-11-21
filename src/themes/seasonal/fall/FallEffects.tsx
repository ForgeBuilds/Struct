import FallingLeaves from "../shared/FallingLeaves";
import RisingMotes from "../shared/RisingMotes";

export default function FallEffects() {
  return (
    <>
      <div className="seasonal-ambient" aria-hidden="true" />
      <div className="seasonal-frame" aria-hidden="true" />
      <div className="seasonal-decor" aria-hidden="true">
        <FallingLeaves count={36} seed={7} />
        <RisingMotes count={16} seed={31} />
      </div>
    </>
  );
}
