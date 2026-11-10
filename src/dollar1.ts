import { Vec2 } from "dragology";

const NUM_POINTS = 64;
const SQUARE_SIZE = 250;
const HALF_DIAGONAL = 0.5 * Math.hypot(SQUARE_SIZE, SQUARE_SIZE);
const ANGLE_RANGE = 45 * (Math.PI / 180);
const ANGLE_PRECISION = 2 * (Math.PI / 180);
const PHI = 0.5 * (Math.sqrt(5) - 1);
const STEPS_PER_EDGE = 16;

export type GestureTemplate<T> = {
  name: string;
  points: Vec2[];
  indicativeAngleRad: number;
  payload: T;
};

export const pathLength = (points: Vec2[]) => points.slice(1).reduce((sum, p, i) => sum + points[i].dist(p), 0);

export const centroid = (points: Vec2[]) => points.reduce((acc, p) => acc.add(p), Vec2(0, 0)).div(points.length);

const boundingBox = (points: Vec2[]) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
};

const normalizeAngleRad = (rad: number) => {
  const wrapped = (rad + Math.PI) % (2 * Math.PI);
  return (wrapped < 0 ? wrapped + 2 * Math.PI : wrapped) - Math.PI;
};

const indicativeAngle = (points: Vec2[]) => {
  const c = centroid(points);
  return Math.atan2(points[0].y - c.y, points[0].x - c.x);
};

const rotateBy = (points: Vec2[], radians: number) => {
  const c = centroid(points);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return points.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return Vec2(dx * cos - dy * sin + c.x, dx * sin + dy * cos + c.y);
  });
};

const rotateToZero = (points: Vec2[]) => {
  const angleRad = indicativeAngle(points);
  return { points: rotateBy(points, -angleRad), angleRad };
};

const scaleToSquare = (points: Vec2[], size: number) => {
  const { width, height } = boundingBox(points);
  const scaleX = size / (width || 1);
  const scaleY = size / (height || 1);

  return points.map((p) => Vec2(p.x * scaleX, p.y * scaleY));
};

const translateToOrigin = (points: Vec2[]) => {
  const c = centroid(points);
  return points.map((p) => p.sub(c));
};

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

const distanceAtBestAngle = (points: Vec2[], templatePoints: Vec2[], a: number, b: number, threshold: number) => {
  const evalAt = (angle: number) => pathDistance(rotateBy(points, angle), templatePoints);

  let x1 = PHI * a + (1 - PHI) * b;
  let f1 = evalAt(x1);
  let x2 = (1 - PHI) * a + PHI * b;
  let f2 = evalAt(x2);

  while (Math.abs(b - a) > threshold) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = PHI * a + (1 - PHI) * b;
      f1 = evalAt(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = (1 - PHI) * a + PHI * b;
      f2 = evalAt(x2);
    }
  }

  return f1 < f2 ? { distance: f1, angleRad: x1 } : { distance: f2, angleRad: x2 };
};

export const normalizeDollar1 = (rawPoints: Vec2[]) => {
  const resampled = resample(rawPoints, NUM_POINTS);
  const { points: rotated, angleRad: indicativeAngleRad } = rotateToZero(resampled);
  const scaled = scaleToSquare(rotated, SQUARE_SIZE);

  return {
    points: translateToOrigin(scaled),
    indicativeAngleRad,
  };
};

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
        ...normalizeDollar1([...raw, startVertex]),
        payload,
      };
    }),
  );
};

export const recognizeDollar1 = <T>(rawPoints: Vec2[], templates: GestureTemplate<T>[]) => {
  if (rawPoints.length < 4 || templates.length === 0) return null;

  const candidate = normalizeDollar1(rawPoints);

  const scored = templates.map((template) => {
    const { distance, angleRad } = distanceAtBestAngle(candidate.points, template.points, -ANGLE_RANGE, ANGLE_RANGE, ANGLE_PRECISION);
    const worldAngleDiff = Math.abs(normalizeAngleRad(candidate.indicativeAngleRad - angleRad - template.indicativeAngleRad));
    const rotationPenalty = (worldAngleDiff / Math.PI) * HALF_DIAGONAL * 0.5;
    return { template, effectiveDist: distance + rotationPenalty };
  });

  const best = scored.reduce((min, cur) => (cur.effectiveDist < min.effectiveDist ? cur : min));

  return {
    template: best.template,
    score: Math.max(0, 1 - best.effectiveDist / HALF_DIAGONAL),
  };
};
