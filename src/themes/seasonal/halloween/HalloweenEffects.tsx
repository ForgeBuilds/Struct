import type { CSSProperties } from "react";
import RisingMotes from "../shared/RisingMotes";
import { seededRandom } from "../shared/random";

type BatVars = CSSProperties & {
  "--bat-y": string;
  "--bat-size": string;
  "--bat-opacity": number;
  "--bat-duration": string;
};

const bats = Array.from({ length: 7 }, (_, index) => {
  const random = seededRandom(index * 613 + 211);
  return {
    y: 8 + random() * 64,
    size: 15 + random() * 15,
    opacity: 0.45 + random() * 0.35,
    duration: 30 + random() * 30,
    delay: random() * 30,
    reverse: random() < 0.5,
  };
});

function Bat({ index }: { index: number }) {
  const bat = bats[index];
  const style: BatVars = {
    "--bat-y": `${bat.y.toFixed(1)}%`,
    "--bat-size": `${bat.size.toFixed(1)}px`,
    "--bat-opacity": Number(bat.opacity.toFixed(3)),
    "--bat-duration": `${bat.duration.toFixed(1)}s`,
    animationDelay: `-${bat.delay.toFixed(1)}s`,
  };

  return (
    <div className="seasonal-bat" data-direction={bat.reverse ? "rtl" : "ltr"} style={style}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 6.2c-.8 0-1.5.4-1.9 1.1C8 5.6 5.3 4.9 2 5.2c.7 2.3 2.5 4 4.9 4.8-1.9.7-3.5 2-4.7 3.9 2.9.4 5.5-.5 7.5-2.3-.6 2.2 0 4.3 1.6 5.9 1.2-1.9 1.5-4 .8-6.1 1.6 1 3.3 1.5 5.2 1.4-1.1-2-2.7-3.5-4.7-4.5 2.3-1 4-2.9 4.6-5.1-3.2-.4-5.9.3-7.9 2.2-.5-.8-1.3-1.2-2.1-1.2Z" />
      </svg>
    </div>
  );
}

function Web({ corner }: { corner: "tl" | "br" }) {
  return (
    <div className={`seasonal-web seasonal-web--${corner}`}>
      <svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="0.7" strokeLinecap="round">
          <path d="M0 0L100 0M0 0L100 24M0 0L100 56M0 0L100 100M0 0L56 100M0 0L24 100M0 0L0 100" />
          <path d="M0 18Q12 12 18 0M0 38Q26 26 38 0M0 58Q40 40 58 0M0 78Q54 54 78 0" />
        </g>
      </svg>
    </div>
  );
}

export default function HalloweenEffects() {
  return (
    <>
      <div className="seasonal-ambient" aria-hidden="true" />
      <div className="seasonal-frame" aria-hidden="true" />
      <div className="seasonal-decor" aria-hidden="true">
        <div className="seasonal-fog">
          <span />
          <span />
          <span />
        </div>
        <Web corner="tl" />
        <Web corner="br" />
        {bats.map((_, index) => (
          <Bat key={`bat-${index}`} index={index} />
        ))}
        <RisingMotes count={20} seed={23} />
      </div>
    </>
  );
}
