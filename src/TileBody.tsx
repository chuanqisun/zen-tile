import { rotateDeg } from "dragology";
import { useEffect, useSyncExternalStore } from "react";
import { getHandDrawnPaths } from "./handdrawn";
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

export function TileBody({ tileId, type, shared, angle, animate }: { tileId: string; type: ShapeId; shared?: boolean[]; angle: number; animate: boolean }) {
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

  return (
    <g transform={rotateDeg(shown)}>
      <path d={paths.fill} fill={getTileFill(tileId)} />
      <path d={paths.stroke} fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </g>
  );
}
