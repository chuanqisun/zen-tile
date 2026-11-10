import { Vec2 } from "dragology";
import { seededRandom } from "./random";

const SEGMENTS = 5;
const AMPLITUDE = 1.8; // px of sideways wander in tile-local units
const ALONG_JITTER = 1.2;

const f = (n: number) => n.toFixed(2);

/** A hand-drawn-looking edge: endpoints stay exact (so corners meet), interior wanders, smoothed by Catmull-Rom. */
const wobblyEdge = (a: Vec2, b: Vec2, rand: () => number) => {
  const dir = b.sub(a);
  const normal = dir.perp().norm();
  const tangent = dir.norm();
  const pts = [a];
  for (let k = 1; k < SEGMENTS; k++) {
    const base = a.lerp(b, k / SEGMENTS);
    const side = (rand() * 2 - 1) * AMPLITUDE;
    const along = (rand() * 2 - 1) * ALONG_JITTER;
    pts.push(base.add(normal.mul(side)).add(tangent.mul(along)));
  }
  pts.push(b);

  return pts
    .slice(0, -1)
    .map((p1, i) => {
      const p0 = pts[Math.max(i - 1, 0)];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const c1 = p1.add(p2.sub(p0).div(6));
      const c2 = p2.sub(p3.sub(p1).div(6));
      return `C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`;
    })
    .join(" ");
};

const cache = new Map<string, { fill: string; stroke: string }>();

/**
 * Paths for a hand-drawn tile, in the tile's local frame.
 *
 * `shared[i]` marks edge i (vertices[i] -> vertices[i + 1]) as lying on an older tile. Those edges are
 * straight in the fill (the older tile, drawn on top, supplies the visible boundary) and get no stroke,
 * so existing edges win and are never redrawn.
 */
export const getHandDrawnPaths = (vertices: Vec2[], id: string, shared: boolean[] = []) => {
  const key = `${id}|${vertices.length}|${shared.map(Number).join("")}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const n = vertices.length;
  const rand = seededRandom(id);
  // Draw every edge's curve up front, so an edge's wobble doesn't depend on which others are shared.
  const curves = vertices.map((v, i) => wobblyEdge(v, vertices[(i + 1) % n], rand));
  const start = (v: Vec2) => `M${f(v.x)},${f(v.y)}`;
  const line = (v: Vec2) => `L${f(v.x)},${f(v.y)}`;

  const fill = start(vertices[0]) + vertices.map((_, i) => (shared[i] ? line(vertices[(i + 1) % n]) : curves[i])).join(" ") + "Z";

  const firstShared = shared.findIndex(Boolean);
  // Walk edges starting just after a shared one, so every run of free edges begins with a move-to.
  const order = Array.from({ length: n }, (_, k) => (firstShared + 1 + k) % n);
  const stroke =
    firstShared < 0
      ? fill
      : order
          .filter((i) => !shared[i])
          .map((i) => (shared[(i + n - 1) % n] ? start(vertices[i]) : "") + curves[i])
          .join(" ");

  const result = { fill, stroke };
  cache.set(key, result);
  return result;
};
