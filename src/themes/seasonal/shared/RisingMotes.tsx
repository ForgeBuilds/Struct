import { useMemo, type CSSProperties } from "react";
import { seededRandom } from "./random";

type MoteVars = CSSProperties & {
  "--mote-size": string;
  "--mote-drift": string;
  "--mote-opacity": number;
};

interface RisingMotesProps {
  count?: number;
  seed?: number;
}

export default function RisingMotes({ count = 18, seed = 11 }: RisingMotesProps) {
  const motes = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => {
        const random = seededRandom(seed * 1709 + index * 613 + 97);
        const duration = 9 + random() * 12;
        return {
          x: 2 + random() * 96,
          size: 1.5 + random() * 2.8,
          duration,
          delay: random() * duration,
          drift: (random() < 0.5 ? -1 : 1) * (10 + random() * 34),
          opacity: 0.32 + random() * 0.4,
        };
      }),
    [count, seed],
  );

  return (
    <div className="seasonal-motes">
      {motes.map((mote, index) => {
        const style: MoteVars = {
          left: `${mote.x.toFixed(2)}%`,
          animationDelay: `-${mote.delay.toFixed(2)}s`,
          animationDuration: `${mote.duration.toFixed(2)}s`,
          "--mote-size": `${mote.size.toFixed(1)}px`,
          "--mote-drift": `${mote.drift.toFixed(1)}px`,
          "--mote-opacity": Number(mote.opacity.toFixed(3)),
        };
        return <span key={`mote-${index}`} className="seasonal-mote" style={style} />;
      })}
    </div>
  );
}
