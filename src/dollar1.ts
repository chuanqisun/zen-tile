import { Vec2 } from "dragology";

const NUM_POINTS = 64;
const STEPS_PER_EDGE = 16;
const MAX_CHAINED_RUNS = 3;

export type GestureTemplate<T> = {
  name: string;
  points: Vec2[];
  payload: T;
};

export const pathLength = (points: Vec2[]) => points.slice(1).reduce((sum, p, i) => sum + points[i].dist(p), 0);

export const centroid = (points: Vec2[]) => points.reduce((acc, p) => acc.add(p), Vec2(0, 0)).div(points.length);

const resample = (points: Vec2[], n: number) => {
  const pts = points.map((p) => Vec2(p.x, p.y));
  const interval = pathLength(pts) / (n - 1);
  if (interval <= 1e-6) {
    return Array.from({ length: n }, () => Vec2(pts[0].x, pts[0].y));
  }

  let accumulated = 0;
  const resampled = [Vec2(pts[0].x, pts[0].y)];

  for (let i = 1; i < pts.length; i++) {
    const d = pts[i - 1].dist(pts[i]);
    if (accumulated + d >= interval && d > 0) {
      const q = pts[i - 1].lerp(pts[i], (interval - accumulated) / d);
      resampled.push(q);
      pts.splice(i, 0, q);
      accumulated = 0;
    } else {
      accumulated += d;
    }
  }

  while (resampled.length < n) {
    resampled.push(Vec2(pts[pts.length - 1].x, pts[pts.length - 1].y));
  }

  return resampled.slice(0, n);
};

const pathDistance = (pts1: Vec2[], pts2: Vec2[]) => pts1.reduce((sum, p, i) => sum + p.dist(pts2[i]), 0) / pts1.length;

const sampleEdgePath = (edges: [Vec2, Vec2][]) => {
  const pts = edges.flatMap(([v0, v1]) => Array.from({ length: STEPS_PER_EDGE }, (_, s) => v0.lerp(v1, s / STEPS_PER_EDGE)));
  return [...pts, edges[edges.length - 1][1]];
};

/**
 * Stroke templates for a polygon outline.
 *
 * `sharedEdges[i]` marks edge `i` (vertices[i] -> vertices[i + 1]) as already present in the sculpture, so
 * the user doesn't need to draw it. For every maximal run of consecutive free edges we add an open-path
 * template (both directions). The full closed outline is always included too, for users who trace everything.
 */
export const makePolygonStrokeTemplates = <T>(vertices: Vec2[], name: string, payload: T, sharedEdges: boolean[] = []) => {
  const n = vertices.length;
  const edge = (i: number): [Vec2, Vec2] => [vertices[i % n], vertices[(i + 1) % n]];

  const full = vertices.flatMap((startVertex, startIdx) =>
    [1, -1].map((dir) => {
      const raw = Array.from({ length: n }, (_, e) => {
        const v0 = vertices[(startIdx + e * dir + n * 10) % n];
        const v1 = vertices[(startIdx + (e + 1) * dir + n * 10) % n];
        return Array.from({ length: STEPS_PER_EDGE }, (_, s) => v0.lerp(v1, s / STEPS_PER_EDGE));
      }).flat();

      return { name, points: resample([...raw, startVertex], NUM_POINTS), payload };
    }),
  );

  const isShared = (i: number) => sharedEdges[((i % n) + n) % n] ?? false;
  const sharedCount = Array.from({ length: n }, (_, i) => i).filter(isShared).length;
  if (sharedCount === 0 || sharedCount === n) return full;

  // Runs of free edges: begin at each free edge whose predecessor is shared.
  const runs = Array.from({ length: n }, (_, i) => i)
    .filter((i) => !isShared(i) && isShared(i - 1))
    .map((start) => {
      const run: number[] = [];
      for (let i = start; !isShared(i); i++) run.push(i);
      return run;
    });

  // The user draws free runs in one continuous stroke, in any order and direction, with the pen
  // travelling straight from the end of one run to the start of the next. Cap the factorial blowup.
  const orientations = (run: number[]) => {
    const forward = run.map(edge);
    const backward = run
      .map(edge)
      .reverse()
      .map(([v0, v1]): [Vec2, Vec2] => [v1, v0]);
    return [forward, backward];
  };
  const permutations = <X>(xs: X[]): X[][] =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
  const chainsFor = (runSet: number[][]) =>
    permutations(runSet).flatMap((ordered) => {
      const combos = ordered.reduce<[Vec2, Vec2][][][]>((acc, run) => acc.flatMap((prefix) => orientations(run).map((o) => [...prefix, o])), [[]]);
      return combos.map((parts) =>
        parts.flatMap((part, k) => (k === 0 ? part : [[parts[k - 1][parts[k - 1].length - 1][1], part[0][0]] as [Vec2, Vec2], ...part])),
      );
    });

  const chains = runs.length <= MAX_CHAINED_RUNS ? chainsFor(runs) : runs.flatMap((r) => orientations(r));
  const open = chains.map((edges) => ({ name, points: resample(sampleEdgePath(edges), NUM_POINTS), payload }));

  return [...open, ...full];
};

export const recognizeDollar1 = <T>(rawPoints: Vec2[], templates: GestureTemplate<T>[], maxDistance = Infinity) => {
  if (rawPoints.length < 4 || templates.length === 0) return null;

  const candidate = resample(rawPoints, NUM_POINTS);

  const scored = templates.map((template) => ({
    template,
    distance: pathDistance(candidate, template.points),
  }));

  const best = scored.reduce((min, cur) => (cur.distance < min.distance ? cur : min));
  if (best.distance > maxDistance) return null;

  return {
    template: best.template,
    distance: best.distance,
  };
};
