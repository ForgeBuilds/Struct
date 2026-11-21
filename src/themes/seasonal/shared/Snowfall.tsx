import { useReducedMotion } from "motion/react";

export default function Snowfall() {
  const reduce = useReducedMotion();

  return (
    <div
      className="seasonal-snowfall"
      aria-hidden="true"
      style={
        reduce
          ? {}
          : {
              animation: "seasonal-snow-fall linear infinite",
              animationDuration: "25s",
            }
      }
    >
      {Array.from({ length: 200 }).map((_, i) => {
        const left = Math.random() * 100;
        const size = 2 + Math.random() * 4;
        const duration = 15 + Math.random() * 15;
        const delay = Math.random() * 25;

        return (
          <div
            key={i}
            className="seasonal-snowflake"
            style={{
              left: `${left}%`,
              width: `${size}px`,
              height: `${size}px`,
              animationDelay: `-${delay}s`,
              animationDuration: `${duration}s`,
            }}
          >
            <svg viewBox="0 0 10 10" width={size} height={size} fill="none">
              <circle cx={5} cy={5} r={4} fill="#ffffff" opacity={0.7} />
            </svg>
          </div>
        );
      })}
    </div>
  );
}