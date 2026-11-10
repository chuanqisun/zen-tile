import type { ReactNode } from "react";
import type { ShapeId } from "./tiling";

/**
 * Black/white tile fills, generated from code.
 *
 * Shared grammar so the set reads as one family: a ~24px module, pure black on pure white,
 * one stroke weight (SW), round/flat geometry only, and every pattern is a seamless tile.
 * Each pattern is keyed to its shape (the sides, the acute angle, or the golden-ish Fibonacci
 * rhythm) so no two tiles look alike.
 */

const SW = 3;
const ink = "black";

type PatternDef = { w: number; h: number; rotate?: number; body: ReactNode };

// Deterministic PRNG so patterns are stable across renders and reloads.
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const grid = (n: number) => Array.from({ length: n }, (_, i) => i);

const hexPoints = (cx: number, cy: number, r: number) =>
  grid(6)
    .map((k) => {
      const a = (-90 + 60 * k) * (Math.PI / 180);
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    })
    .join(" ");

type Rand = () => number;
const range = (r: Rand, lo: number, hi: number) => lo + (hi - lo) * r();
const int = (r: Rand, lo: number, hi: number) => Math.floor(range(r, lo, hi + 1));
const pick = <T,>(r: Rand, xs: T[]) => xs[int(r, 0, xs.length - 1)];

/** Triangle (3): hex-packed dot lattice with a random dot size and tilt. */
const triangleDots = (r: Rand): PatternDef => {
  const spacing = range(r, 18, 28);
  const h = spacing * Math.sqrt(3);
  const dot = range(r, 2.5, 6);
  const dots: [number, number][] = [[0, 0], [spacing, 0], [0, h], [spacing, h], [spacing / 2, h / 2]];
  return { w: spacing, h, rotate: pick(r, [0, 0, 30, 90]), body: dots.map(([x, y], k) => <circle key={k} cx={x} cy={y} r={dot} fill={ink} />) };
};

/** Square (4): checkerboard, random cell size, sometimes on the diagonal. */
const squareChecker = (r: Rand): PatternDef => {
  const c = range(r, 8, 15);
  return {
    w: 2 * c,
    h: 2 * c,
    rotate: pick(r, [0, 0, 45]),
    body: (
      <g fill={ink}>
        <rect width={c} height={c} />
        <rect x={c} y={c} width={c} height={c} />
      </g>
    ),
  };
};

/** Pentagon (5): bullseye lattice with a random number of rings. */
const pentagonBullseyes = (r: Rand): PatternDef => {
  const size = range(r, 20, 30);
  const m = size / 2;
  const rings = int(r, 1, 3);
  const step = (m - SW / 2) / (rings + 0.6);
  return {
    w: size,
    h: size,
    body: (
      <g>
        {grid(rings).map((k) => (
          <circle key={k} cx={m} cy={m} r={m - SW / 2 - k * step * 1.0} fill="none" stroke={ink} strokeWidth={SW * 0.8} />
        ))}
        <circle cx={m} cy={m} r={range(r, 2.5, 5)} fill={ink} />
      </g>
    ),
  };
};

/** Hexagon (6): honeycomb with random cell size and filled cells. */
const hexagonHoneycomb = (r: Rand): PatternDef => {
  const rad = range(r, 9, 15);
  const w = rad * Math.sqrt(3);
  const h = 3 * rad;
  const outline: [number, number][] = [[0, 0], [w, 0], [0, h], [w, h]];
  const fillCorner = r() < 0.35;
  return {
    w,
    h,
    body: (
      <g>
        {outline.map(([x, y], k) => (
          <polygon key={k} points={hexPoints(x, y, rad)} fill={fillCorner ? ink : "none"} stroke={ink} strokeWidth={SW} />
        ))}
        <polygon points={hexPoints(w / 2, h / 2, rad)} fill={fillCorner ? "none" : ink} stroke={ink} strokeWidth={SW} />
      </g>
    ),
  };
};

/** Octagon (8): Truchet quarter-arcs on a random block. */
const octagonTruchet = (r: Rand): PatternDef => {
  const cell = range(r, 10, 16);
  const n = int(r, 3, 5);
  const rad = cell / 2;
  const arcs = grid(n).flatMap((i) =>
    grid(n).map((j) => {
      const d =
        r() < 0.5
          ? `M${rad},0 A${rad},${rad} 0 0 1 0,${rad} M${rad},${cell} A${rad},${rad} 0 0 1 ${cell},${rad}`
          : `M${rad},0 A${rad},${rad} 0 0 0 ${cell},${rad} M0,${rad} A${rad},${rad} 0 0 1 ${rad},${cell}`;
      return <path key={`${i}-${j}`} transform={`translate(${i * cell} ${j * cell})`} d={d} fill="none" stroke={ink} strokeWidth={SW} />;
    }),
  );
  return { w: n * cell, h: n * cell, body: <g>{arcs}</g> };
};

/** Decagon (10): halftone dots on a random sine lattice. */
const decagonHalftone = (r: Rand): PatternDef => {
  const n = int(r, 4, 6);
  const cell = range(r, 8, 12);
  const fx = int(r, 1, 2);
  const fy = int(r, 1, 2);
  const phase = range(r, 0, Math.PI * 2);
  const maxR = cell * 0.46;
  const dots = grid(n).flatMap((i) =>
    grid(n).map((j) => {
      const t = 0.5 + 0.5 * Math.sin((2 * Math.PI * fx * i) / n + phase) * Math.cos((2 * Math.PI * fy * j) / n);
      return <circle key={`${i}-${j}`} cx={cell * i + cell / 2} cy={cell * j + cell / 2} r={0.8 + (maxR - 0.8) * t} fill={ink} />;
    }),
  );
  return { w: n * cell, h: n * cell, rotate: pick(r, [0, 0, 45]), body: <g>{dots}</g> };
};

/** Dodecagon (12): plaid with a random Fibonacci band rhythm. */
const dodecagonPlaid = (r: Rand): PatternDef => {
  const half = grid(int(r, 2, 4)).map(() => pick(r, [1, 2, 3, 5, 8]));
  const bands = [...half, ...half.slice().reverse()]; // even count so parity wraps
  const total = bands.reduce((a, b) => a + b, 0);
  const starts = bands.map((_, i) => bands.slice(0, i).reduce((a, b) => a + b, 0));
  const rects = bands.flatMap((bw, i) =>
    bands.flatMap((bh, j) => ((i + j) % 2 === 0 ? [] : [<rect key={`${i}-${j}`} x={starts[i]} y={starts[j]} width={bw} height={bh} fill={ink} />])),
  );
  return { w: total, h: total, body: <g>{rects}</g> };
};

/** Rhombus 30: hairlines at a random tilt near the acute angle. */
const rhombusLines = (r: Rand): PatternDef => {
  const period = range(r, 6, 10);
  return { w: period, h: period, rotate: range(r, 15, 60), body: <rect width={period} height={range(r, 2, 3.5)} fill={ink} /> };
};

/** Rhombus 36: chevron stripes with random pitch and depth. */
const rhombusChevrons = (r: Rand): PatternDef => {
  const w = range(r, 10, 18);
  const depth = range(r, 4, 9);
  const h = depth + range(r, 4, 7);
  return { w, h, body: <polyline points={`0,2 ${w / 2},${2 + depth} ${w},2`} fill="none" stroke={ink} strokeWidth={SW} /> };
};

/** Rhombus 45: nested diamonds with random ring ratios. */
const rhombusDiamonds = (r: Rand): PatternDef => {
  const size = range(r, 18, 30);
  const m = size / 2;
  const diamond = (rad: number) => `${m},${m - rad} ${m + rad},${m} ${m},${m + rad} ${m - rad},${m}`;
  const rings = int(r, 2, 3);
  const radii = grid(rings).map((k) => m * (1 - k / (rings + range(r, 0.2, 0.8))));
  return {
    w: size,
    h: size,
    body: <g>{radii.map((rad, k) => <polygon key={k} points={diamond(rad)} fill={k % 2 === 0 ? ink : "white"} />)}</g>,
  };
};

/** Rhombus 60: triangle tessellation, sometimes with a hollowed core. */
const rhombusTriangles = (r: Rand): PatternDef => {
  const w = range(r, 18, 30);
  const h = (w * Math.sqrt(3)) / 2;
  const hollow = r() < 0.5;
  const k = range(r, 0.3, 0.55);
  const cx = w / 2;
  const cy = h * (2 / 3);
  const inner = `${cx},${cy - h * k * 0.9} ${cx + w * k * 0.5},${cy + h * k * 0.3} ${cx - w * k * 0.5},${cy + h * k * 0.3}`;
  return {
    w,
    h,
    body: (
      <g>
        <polygon points={`0,${h} ${w / 2},0 ${w},${h}`} fill={ink} />
        {hollow && <polygon points={inner} fill="white" />}
      </g>
    ),
  };
};

/** Rhombus 72: "10 PRINT" diagonal maze with random bias. */
const rhombusMaze = (r: Rand): PatternDef => {
  const cell = range(r, 9, 15);
  const n = int(r, 3, 5);
  const bias = range(r, 0.3, 0.7);
  const slashes = grid(n).flatMap((i) =>
    grid(n).map((j) => {
      const x = i * cell;
      const y = j * cell;
      const flip = r() < bias;
      return (
        <line key={`${i}-${j}`} x1={x} y1={flip ? y : y + cell} x2={x + cell} y2={flip ? y + cell : y} stroke={ink} strokeWidth={SW} strokeLinecap="square" />
      );
    }),
  );
  return { w: n * cell, h: n * cell, body: <g>{slashes}</g> };
};

const PATTERNS: Record<ShapeId, (r: Rand) => PatternDef> = {
  "reg-3": triangleDots,
  "reg-4": squareChecker,
  "reg-5": pentagonBullseyes,
  "reg-6": hexagonHoneycomb,
  "reg-8": octagonTruchet,
  "reg-10": decagonHalftone,
  "reg-12": dodecagonPlaid,
  "rhombus-30": rhombusLines,
  "rhombus-36": rhombusChevrons,
  "rhombus-45": rhombusDiamonds,
  "rhombus-60": rhombusTriangles,
  "rhombus-72": rhombusMaze,
};

// Fresh per page load, so every session gets its own set; mixed with each tile's id so
// every instance within a session differs too.
const SESSION_SEED = (Math.random() * 2 ** 32) >>> 0;

const hashString = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Each tile instance (by id) has its own pattern. */
export const getTileFill = (tileId: string) => `url(#tile-pattern-${tileId})`;

export type TileRef = { id: string; type: ShapeId };

/** Mount once, outside the Dragology tree; patterns are referenced by document-wide url(#id). */
export function TilePatternDefs({ tiles }: { tiles: TileRef[] }) {
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
      <defs>
        {tiles.map(({ id, type }) => {
          const { w, h, rotate, body } = PATTERNS[type](mulberry32(SESSION_SEED ^ hashString(id)));
          return (
            <pattern
              key={id}
              id={`tile-pattern-${id}`}
              width={w}
              height={h}
              patternUnits="userSpaceOnUse"
              patternTransform={rotate ? `rotate(${rotate})` : undefined}
            >
              <rect width={w} height={h} fill="white" />
              {body}
            </pattern>
          );
        })}
      </defs>
    </svg>
  );
}
