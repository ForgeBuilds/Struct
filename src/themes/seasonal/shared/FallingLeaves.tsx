import { useMemo, type CSSProperties } from "react";
import { seededRandom } from "./random";

const LEAF_PATHS = [
  // Maple
  "M12 1.9 13.9 6.3 17 4.1 16.3 8.2 20.3 7 17.9 10.4 22 11.3 18.5 13.7 21.6 15.4 17 15.8 17.6 19 13.9 17.4 12 21.9 10.1 17.4 6.4 19 7 15.8 2.4 15.4 5.5 13.7 2 11.3 6.1 10.4 3.7 7 7.7 8.2 7 4.1 10.1 6.3Z",
  // Oak
  "M12 2.4c3.3-.2 5.6 2.3 5.4 5.3 2 .5 3.3 2.2 3 4.2-.2 1.7-1.5 2.9-3.1 3.2.1 2.4-1.7 4.4-4.1 4.4-1 1.3-2.4 2.1-4.2 2.1s-3.2-.8-4.2-2.1c-2.4 0-4.2-2-4.1-4.4-1.6-.3-2.9-1.5-3.1-3.2-.3-2 1-3.7 3-4.2-.2-3 2.1-5.5 5.4-5.3Z",
  // Birch
  "M12 2c3.9 3.7 6 7.6 6 11.1a6 6 0 0 1-12 0C6 9.6 8.1 5.7 12 2Z",
];

const LEAF_COLORS = [
  "var(--leaf-amber)",
  "var(--leaf-rust)",
  "var(--leaf-olive)",
  "var(--leaf-crimson)",
] as const;

type LeafVars = CSSProperties & {
  "--leaf-size": string;
  "--leaf-drift": string;
  "--leaf-spin": string;
  "--leaf-opacity": number;
  "--leaf-sway": string;
  "--leaf-static-y": string;
};

interface FallingLeavesProps {
  count?: number;
  seed?: number;
}

export default function FallingLeaves({ count = 34, seed = 7 }: FallingLeavesProps) {
  const leaves = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => {
        const random = seededRandom(seed * 1319 + index * 977 + 13);
        const duration = 9 + random() * 12;
        return {
          x: 1 + random() * 98,
          staticY: 4 + random() * 90,
          size: 8 + random() * 9,
          duration,
          delay: random() * duration,
          drift: (random() < 0.5 ? -1 : 1) * (20 + random() * 70),
          spin: (random() < 0.5 ? -1 : 1) * (120 + random() * 420),
          sway: 8 + random() * 20,
          swayDuration: 3 + random() * 4,
          opacity: 0.42 + random() * 0.36,
          color: LEAF_COLORS[Math.floor(random() * LEAF_COLORS.length)],
          variant: Math.floor(random() * LEAF_PATHS.length),
        };
      }),
    [count, seed],
  );

  return (
    <div className="seasonal-leaves">
      {leaves.map((leaf, index) => {
        const style: LeafVars = {
          left: `${leaf.x.toFixed(2)}%`,
          color: leaf.color,
          animationDelay: `-${leaf.delay.toFixed(2)}s`,
          animationDuration: `${leaf.duration.toFixed(2)}s`,
          "--leaf-size": `${leaf.size.toFixed(1)}px`,
          "--leaf-drift": `${leaf.drift.toFixed(1)}px`,
          "--leaf-spin": `${leaf.spin.toFixed(0)}deg`,
          "--leaf-opacity": Number(leaf.opacity.toFixed(3)),
          "--leaf-sway": `${leaf.sway.toFixed(1)}px`,
          "--leaf-static-y": `${leaf.staticY.toFixed(1)}%`,
        };

        return (
          <div key={`leaf-${index}`} className="seasonal-leaf" style={style}>
            <span
              className="seasonal-leaf-inner"
              style={{
                animationDuration: `${leaf.swayDuration.toFixed(2)}s`,
                animationDelay: `-${(leaf.delay * 0.6).toFixed(2)}s`,
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d={LEAF_PATHS[leaf.variant]} fill="currentColor" />
                <path
                  d="M12 5v15"
                  stroke="rgba(0, 0, 0, 0.16)"
                  strokeWidth="0.9"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </div>
        );
      })}
    </div>
  );
}
