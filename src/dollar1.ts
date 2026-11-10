import { Vec2 } from "dragology";

const NUM_POINTS = 64;
const STEPS_PER_EDGE = 16;

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

export const makePolygonStrokeTemplates = <T>(vertices: Vec2[], name: string, payload: T) => {
  const n = vertices.length;

  return vertices.flatMap((startVertex, startIdx) =>
    [1, -1].map((dir) => {
      const raw = Array.from({ length: n }, (_, edge) => {
        const v0 = vertices[(startIdx + edge * dir + n * 10) % n];
        const v1 = vertices[(startIdx + (edge + 1) * dir + n * 10) % n];
        return Array.from({ length: STEPS_PER_EDGE }, (_, s) => v0.lerp(v1, s / STEPS_PER_EDGE));
      }).flat();

      return {
        name,
        points: resample([...raw, startVertex], NUM_POINTS),
        payload,
      };
    }),
  );
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
