import type { CSSProperties } from "react";

const flakeColors = ["#f5fbff", "#53c878", "#ff6268", "#ffd166"];

const snowflakes = Array.from({ length: 500 }, (_, index) => {
  const random = (salt: number) => {
    let value = Math.imul(index + 1 + salt * 101, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  const duration = 21 + random(3) * 10;

  return {
    x: 2 + random(1) * 96,
    y: random(2) * 100,
    delay: random(4) * duration,
    duration,
    drift: Math.round(random(5) * 36 - 18),
    size: 4 + random(6) * 4,
    opacity: 0.36 + random(7) * 0.14,
    color: flakeColors[
      random(8) < 0.58 ? 0 : random(8) < 0.73 ? 1 : random(8) < 0.88 ? 2 : 3
    ],
  };
});

export default function SeasonalEffects() {
  return (
    <div className="seasonal-snowfall" aria-hidden="true">
      {snowflakes.map((flake, index) => {
        const style: CSSProperties & {
          "--flake-drift": string;
          "--flake-static-y": string;
          "--flake-opacity": number;
          "--flake-color": string;
        } = {
          left: `${flake.x}%`,
          "--flake-static-y": `${flake.y}%`,
          width: flake.size,
          height: flake.size,
          animationDelay: `-${flake.delay}s`,
          animationDuration: `${flake.duration}s`,
          "--flake-drift": `${flake.drift}px`,
          "--flake-opacity": flake.opacity,
          "--flake-color": flake.color,
        };
        return (
          <svg
            key={index}
            className={`seasonal-snowflake${index % 3 === 0 ? " seasonal-snowflake-crystal" : ""}`}
            style={style}
            viewBox="0 0 16 16"
            fill="none"
          >
            {index % 3 === 0 ? (
              <path
                d="M8 1v14M2 4.5l12 7M14 4.5l-12 7M8 1 6.5 2.7M8 1l1.5 1.7M8 15l-1.5-1.7M8 15l1.5-1.7M2 4.5l2.2.2M2 4.5l.8 2M14 4.5l-2.2.2M14 4.5l-.8 2M2 11.5l2.2-.2M2 11.5l.8-2M14 11.5l-2.2-.2M14 11.5l-.8-2"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.1"
              />
            ) : (
              <circle cx="8" cy="8" r="3" fill="currentColor" />
            )}
          </svg>
        );
      })}
    </div>
  );
}
