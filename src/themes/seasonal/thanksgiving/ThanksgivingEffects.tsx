import FallingLeaves from "../shared/FallingLeaves";
import RisingMotes from "../shared/RisingMotes";

function Wheat({ side }: { side: "left" | "right" }) {
  return (
    <div className={`seasonal-wheat seasonal-wheat--${side}`}>
      <span className="seasonal-wheat-flip">
        <svg viewBox="0 0 48 120" fill="none" aria-hidden="true">
          <path d="M24 118V30" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M24 32L20 20M24 32l4-12" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
          <g fill="currentColor">
            {[28, 42, 56, 70, 84].map((y) => (
              <g key={y} transform={`translate(0 ${y - 28})`}>
                <path d="M24 34c-6-2-9-8-8-14 6 1 10 6 8 14Z" />
                <path d="M24 34c6-2 9-8 8-14-6 1-10 6-8 14Z" />
              </g>
            ))}
          </g>
        </svg>
      </span>
    </div>
  );
}

export default function ThanksgivingEffects() {
  return (
    <>
      <div className="seasonal-ambient" aria-hidden="true" />
      <div className="seasonal-frame" aria-hidden="true" />
      <div className="seasonal-decor" aria-hidden="true">
        <FallingLeaves count={26} seed={19} />
        <RisingMotes count={14} seed={41} />
        <Wheat side="left" />
        <Wheat side="right" />
      </div>
    </>
  );
}
