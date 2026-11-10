import { rotateDeg } from "dragology";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getHandDrawnPaths } from "./handdrawn";
import { seededRandom } from "./random";
import { getTileFill } from "./patterns";
import { INK } from "./theme";
import { getLocalVertices, type ShapeId } from "./tiling";

/**
 * A tile's drawing, with its rotation animated here rather than by Dragology.
 *
 * Dragology's `withFloating` takes the dragged element's orientation from whichever target is closest
 * and turns off transitions for it, so switching targets snaps. As a React component this stays mounted
 * across states, and keys its animation by tile id, so the palette copy and the placed copy of the same
 * tile share one continuous angle.
 */

const DURATION_MS = 160;

type Anim = { shown: number; from: number; to: number; start: number; raf: number | null; listeners: Set<() => void> };
const anims = new Map<string, Anim>();

const getAnim = (id: string, angle: number) => {
  let a = anims.get(id);
  if (!a) {
    a = { shown: angle, from: angle, to: angle, start: 0, raf: null, listeners: new Set() };
    anims.set(id, a);
  }
  return a;
};

const emit = (a: Anim) => a.listeners.forEach((l) => l());

const tick = (a: Anim, now: number) => {
  const t = Math.min(1, (now - a.start) / DURATION_MS);
  const eased = 1 - (1 - t) ** 3;
  a.shown = a.from + (a.to - a.from) * eased;
  a.raf = t < 1 ? requestAnimationFrame((n) => tick(a, n)) : null;
  emit(a);
};

const setTarget = (id: string, angle: number, animate: boolean) => {
  const a = getAnim(id, angle);
  if ((((angle - a.to) % 360) + 360) % 360 < 1e-6) return; // already heading to this orientation
  // Turn the short way round, whatever the angles are written as.
  const to = a.shown + ((((angle - a.shown) % 360) + 540) % 360) - 180;

  if (!animate && a.raf === null) {
    a.shown = a.from = a.to = angle;
    emit(a);
    return;
  }

  if (a.raf !== null) cancelAnimationFrame(a.raf);
  a.from = a.shown;
  a.to = to;
  a.start = performance.now();
  a.raf = requestAnimationFrame((n) => tick(a, n));
};

/**
 * Scribble reveal of a sketched tile's fill: a thick zigzag stroke, drawn on over time, masks the fill.
 * It sweeps across the tile from the side where the pen lifted towards (and past) the center.
 * Kept per tile id outside React, so it plays once even if the component remounts.
 */

const SCRIBBLE_WIDTH = 12;

type Reveal = { start: number; duration: number; d: string; done: boolean };
const reveals = new Map<string, Reveal>();

const f = (n: number) => n.toFixed(2);

/** Zigzag covering the convex polygon `verts`, advancing along `dir` (local coords). */
const makeScribble = (verts: { x: number; y: number }[], dir: { x: number; y: number }, rand: () => number) => {
  const len = Math.hypot(dir.x, dir.y);
  const u = len > 1e-6 ? { x: dir.x / len, y: dir.y / len } : { x: 1, y: 0 };
  const v = { x: -u.y, y: u.x };
  const pu = verts.map((p) => p.x * u.x + p.y * u.y);
  const pv = verts.map((p) => p.x * v.x + p.y * v.y);
  const sMin = Math.min(...pu);
  const sMax = Math.max(...pu);

  /** The polygon's extent along v on the line {p · u = s}. */
  const chord = (s: number) => {
    const c = Math.min(sMax - 1e-3, Math.max(sMin + 1e-3, s));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      if ((pu[i] - c) * (pu[j] - c) > 0 || pu[i] === pu[j]) continue;
      const w = pv[i] + ((c - pu[i]) / (pu[j] - pu[i])) * (pv[j] - pv[i]);
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
    }
    return lo <= hi ? [lo, hi] : [0, 0];
  };

  const step = SCRIBBLE_WIDTH / 2; // along u between turns, so neighboring strokes overlap
  const pts: string[] = [];
  const pad = SCRIBBLE_WIDTH * 0.2;
  let side = 0;
  for (let s = sMin - SCRIBBLE_WIDTH / 2; s <= sMax + SCRIBBLE_WIDTH / 2; s += step * (0.8 + 0.2 * rand())) {
    const [lo, hi] = chord(s);
    const w = (side ? hi + pad : lo - pad) + (rand() - 0.5) * SCRIBBLE_WIDTH * 0.4;
    pts.push(`${f(u.x * s + v.x * w)},${f(u.y * s + v.y * w)}`);
    side ^= 1;
  }
  return `M${pts.join("L")}`;
};

const startReveal = (tileId: string, type: ShapeId, angle: number, dir: { x: number; y: number }) => {
  if (reveals.has(tileId)) return;
  // The tile's drawing is rotated by `angle`, so turn the world direction into its local frame.
  const rad = (-angle * Math.PI) / 180;
  const local = { x: dir.x * Math.cos(rad) - dir.y * Math.sin(rad), y: dir.x * Math.sin(rad) + dir.y * Math.cos(rad) };
  const verts = getLocalVertices(type);
  const radius = Math.max(...verts.map((p) => Math.hypot(p.x, p.y)));
  reveals.set(tileId, {
    start: performance.now(),
    duration: Math.min(900, 350 + radius * 5),
    d: makeScribble(verts, local, seededRandom(`${tileId}-reveal`)),
    done: false,
  });
};

const revealProgress = (r: Reveal, now: number) => {
  const t = Math.min(1, Math.max(0, (now - r.start) / r.duration));
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out
};

function useReveal(tileId: string, type: ShapeId, angle: number, dir: { x: number; y: number } | undefined) {
  if (dir) startReveal(tileId, type, angle, dir);
  const reveal = reveals.get(tileId);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!reveal || reveal.done) return;
    let raf = 0;
    const loop = (t: number) => {
      setNow(t);
      if (t - reveal.start >= reveal.duration) {
        reveal.done = true;
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reveal]);

  return reveal && !reveal.done ? { d: reveal.d, progress: revealProgress(reveal, now) } : null;
}

export function TileBody({
  tileId,
  type,
  shared,
  angle,
  animate,
  revealDir,
}: {
  tileId: string;
  type: ShapeId;
  shared?: boolean[];
  angle: number;
  animate: boolean;
  /** Sketched tiles only: world-space direction to scribble the fill in along. */
  revealDir?: { x: number; y: number };
}) {
  const reveal = useReveal(tileId, type, angle, revealDir);
  const anim = getAnim(tileId, angle);
  const shown = useSyncExternalStore(
    (listener) => {
      anim.listeners.add(listener);
      return () => anim.listeners.delete(listener);
    },
    () => anim.shown,
  );

  useEffect(() => setTarget(tileId, angle, animate), [tileId, angle, animate]);

  const paths = getHandDrawnPaths(getLocalVertices(type), tileId, shared);

  const maskId = `reveal-mask-${tileId}`;

  return (
    <g transform={rotateDeg(shown)}>
      {reveal && (
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-1e4} y={-1e4} width={2e4} height={2e4}>
          <path
            d={reveal.d}
            fill="none"
            stroke="white"
            strokeWidth={SCRIBBLE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - reveal.progress}
          />
        </mask>
      )}
      <path d={paths.fill} fill={getTileFill(tileId)} mask={reveal ? `url(#${maskId})` : undefined} />
      <path d={paths.stroke} fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </g>
  );
}
