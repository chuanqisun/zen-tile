import { type Draggable, DraggableRenderer, renderStateReadOnly, rotateDeg, scale, translate, Vec2 } from "dragology";
import { useState } from "react";
import "./App.css";

const UNIT = 60;
const EPS = 0.5;
const SNAP_GAP = 60;

// --- $1 Unistroke Recognizer (from 02-gesture-recognition.html) ---
const NUM_POINTS = 64;
const SQUARE_SIZE = 250.0;
const HALF_DIAGONAL = 0.5 * Math.sqrt(SQUARE_SIZE * SQUARE_SIZE + SQUARE_SIZE * SQUARE_SIZE);
const ANGLE_RANGE = 45.0 * (Math.PI / 180.0);
const ANGLE_PRECISION = 2.0 * (Math.PI / 180.0);
const PHI = 0.5 * (-1.0 + Math.sqrt(5.0));

function pathLength(points: Vec2[]): number {
  let d = 0.0;
  for (let i = 1; i < points.length; i++) {
    d += points[i - 1].dist(points[i]);
  }
  return d;
}

function centroid(points: Vec2[]): Vec2 {
  let x = 0.0;
  let y = 0.0;
  for (let i = 0; i < points.length; i++) {
    x += points[i].x;
    y += points[i].y;
  }
  return Vec2(x / points.length, y / points.length);
}

function boundingBox(points: Vec2[]) {
  let minX = +Infinity;
  let maxX = -Infinity;
  let minY = +Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i].x < minX) minX = points[i].x;
    if (points[i].y < minY) minY = points[i].y;
    if (points[i].x > maxX) maxX = points[i].x;
    if (points[i].y > maxY) maxY = points[i].y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function resample(points: Vec2[], n: number): Vec2[] {
  const pts = points.map((p) => Vec2(p.x, p.y));
  const I = pathLength(pts) / (n - 1);
  if (I <= 1e-6) {
    return Array.from({ length: n }, () => Vec2(pts[0].x, pts[0].y));
  }
  let D = 0.0;
  const newPoints: Vec2[] = [Vec2(pts[0].x, pts[0].y)];

  for (let i = 1; i < pts.length; i++) {
    const d = pts[i - 1].dist(pts[i]);
    if (D + d >= I && d > 0) {
      const qx = pts[i - 1].x + ((I - D) / d) * (pts[i].x - pts[i - 1].x);
      const qy = pts[i - 1].y + ((I - D) / d) * (pts[i].y - pts[i - 1].y);
      const q = Vec2(qx, qy);
      newPoints.push(q);
      pts.splice(i, 0, q);
      D = 0.0;
    } else {
      D += d;
    }
  }
  while (newPoints.length < n) {
    newPoints.push(Vec2(pts[pts.length - 1].x, pts[pts.length - 1].y));
  }
  return newPoints.slice(0, n);
}

function rotateBy(points: Vec2[], radians: number): Vec2[] {
  const c = centroid(points);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((p) => Vec2((p.x - c.x) * cos - (p.y - c.y) * sin + c.x, (p.x - c.x) * sin + (p.y - c.y) * cos + c.y));
}

function normalizeAngleRad(rad: number): number {
  let d = (rad + Math.PI) % (2 * Math.PI);
  if (d < 0) d += 2 * Math.PI;
  return d - Math.PI;
}

function indicativeAngle(points: Vec2[]): number {
  const c = centroid(points);
  return Math.atan2(points[0].y - c.y, points[0].x - c.x);
}

function rotateToZero(points: Vec2[]): { points: Vec2[]; angleRad: number } {
  const theta = indicativeAngle(points);
  return { points: rotateBy(points, -theta), angleRad: theta };
}

function scaleToSquare(points: Vec2[], size: number): Vec2[] {
  const B = boundingBox(points);
  const w = B.width === 0 ? 1 : B.width;
  const h = B.height === 0 ? 1 : B.height;
  return points.map((p) => Vec2(p.x * (size / w), p.y * (size / h)));
}

function translateToOrigin(points: Vec2[]): Vec2[] {
  const c = centroid(points);
  return points.map((p) => Vec2(p.x - c.x, p.y - c.y));
}

function pathDistance(pts1: Vec2[], pts2: Vec2[]): number {
  let d = 0.0;
  for (let i = 0; i < pts1.length; i++) {
    d += pts1[i].dist(pts2[i]);
  }
  return d / pts1.length;
}

function distanceAtBestAngle(points: Vec2[], T: Vec2[], a: number, b: number, threshold: number): { distance: number; angleRad: number } {
  let x1 = PHI * a + (1.0 - PHI) * b;
  let f1 = pathDistance(rotateBy(points, x1), T);

  let x2 = (1.0 - PHI) * a + PHI * b;
  let f2 = pathDistance(rotateBy(points, x2), T);

  while (Math.abs(b - a) > threshold) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = PHI * a + (1.0 - PHI) * b;
      f1 = pathDistance(rotateBy(points, x1), T);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = (1.0 - PHI) * a + PHI * b;
      f2 = pathDistance(rotateBy(points, x2), T);
    }
  }
  return f1 < f2 ? { distance: f1, angleRad: x1 } : { distance: f2, angleRad: x2 };
}

function normalizeDollar1(rawPoints: Vec2[]): { points: Vec2[]; indicativeAngleRad: number } {
  const s1 = resample(rawPoints, NUM_POINTS);
  const s2 = rotateToZero(s1);
  const s3 = scaleToSquare(s2.points, SQUARE_SIZE);
  return {
    points: translateToOrigin(s3),
    indicativeAngleRad: s2.angleRad,
  };
}

type GestureTemplate<T> = {
  name: string;
  points: Vec2[];
  indicativeAngleRad: number;
  payload: T;
};

function makePolygonStrokeTemplates<T>(vertices: Vec2[], name: string, payload: T): GestureTemplate<T>[] {
  const n = vertices.length;
  const templates: GestureTemplate<T>[] = [];
  // Build unistroke templates starting from each vertex in both winding directions (CW & CCW)
  // so sketching a polygon from any corner or direction is accurately matched by $1.
  for (let startIdx = 0; startIdx < n; startIdx++) {
    for (const dir of [1, -1]) {
      const raw: Vec2[] = [];
      const stepsPerEdge = 16;
      for (let edge = 0; edge < n; edge++) {
        const v0 = vertices[(startIdx + edge * dir + n * 10) % n];
        const v1 = vertices[(startIdx + (edge + 1) * dir + n * 10) % n];
        for (let s = 0; s < stepsPerEdge; s++) {
          raw.push(v0.lerp(v1, s / stepsPerEdge));
        }
      }
      raw.push(vertices[startIdx]);
      const norm = normalizeDollar1(raw);
      templates.push({
        name,
        points: norm.points,
        indicativeAngleRad: norm.indicativeAngleRad,
        payload,
      });
    }
  }
  return templates;
}

function recognizeDollar1<T>(rawPoints: Vec2[], templates: GestureTemplate<T>[]): { template: GestureTemplate<T>; score: number } | null {
  if (rawPoints.length < 4 || templates.length === 0) return null;
  const candidate = normalizeDollar1(rawPoints);
  let bestTemplate = templates[0];
  let bestEffectiveDist = +Infinity;

  for (const T of templates) {
    const { distance: d, angleRad: gssAngleRad } = distanceAtBestAngle(candidate.points, T.points, -ANGLE_RANGE, +ANGLE_RANGE, ANGLE_PRECISION);
    // Account for the world-space rotation difference between the sketch and the candidate tile placement:
    // Both candidate and template were rotated by -indicativeAngleRad in Step 2, and candidate was further rotated by gssAngleRad in Step 4.
    // So the net rotation applied to align the sketch with the tile in world space is:
    // (candidate.indicativeAngleRad - gssAngleRad) - T.indicativeAngleRad.
    const worldAngleDiff = Math.abs(normalizeAngleRad(candidate.indicativeAngleRad - gssAngleRad - T.indicativeAngleRad));
    // Penalize templates that require rotating the sketch away from the actual tile orientation on canvas
    const rotationPenalty = (worldAngleDiff / Math.PI) * HALF_DIAGONAL * 0.5;
    const effectiveDist = d + rotationPenalty;

    if (effectiveDist < bestEffectiveDist) {
      bestEffectiveDist = effectiveDist;
      bestTemplate = T;
    }
  }
  const score = Math.max(0, 1.0 - bestEffectiveDist / HALF_DIAGONAL);
  return { template: bestTemplate, score };
}

// Minimalist set of unit-side-length (equilateral) tilable shapes:
// 1. Regular polygons closing crystallographic & quasiperiodic symmetry wedges:
//    - reg-3  (60°)   : Equilateral Triangle
//    - reg-4  (90°)   : Square
//    - reg-5  (108°)  : Regular Pentagon
//    - reg-6  (120°)  : Regular Hexagon
//    - reg-8  (135°)  : Regular Octagon
//    - reg-10 (144°)  : Regular Decagon
//    - reg-12 (150°)  : Regular Dodecagon
// 2. Unit-edge rhombi (parallelograms) complementing the regular polygons to bridge remaining wedges:
//    - rhombus-30 (30°/150°)  : Dodectille / 12-fold bridge (e.g., 360° - 2×90° - 3×60° = 30°)
//    - rhombus-36 (36°/144°)  : Thin Penrose rhombus (10-fold bridge, e.g., 360° - 3×108° = 36°)
//    - rhombus-45 (45°/135°)  : Ammann-Beenker 8-fold rhombus (e.g., 135° octagon / 90° square bridge)
//    - rhombus-60 (60°/120°)  : Rhombille / 60° lozenge (dual of 3.6.3.6)
//    - rhombus-72 (72°/108°)  : Thick Penrose rhombus (10-fold bridge, e.g., 360° - 2×144° = 72°)

type ShapeId = "reg-3" | "reg-4" | "reg-5" | "reg-6" | "reg-8" | "reg-10" | "reg-12" | "rhombus-30" | "rhombus-36" | "rhombus-45" | "rhombus-60" | "rhombus-72";

type ShapeDef = {
  id: ShapeId;
  kind: "regular" | "rhombus";
  order: number;
  vertices: Vec2[];
  uniqueEdgeIndices: number[]; // Edges with distinct interior-angle sequences to test when placing
  boundingRadius: number;
};

function makeRegularVertices(sides: number): Vec2[] {
  const rOut = UNIT / (2 * Math.sin(Math.PI / sides));
  return Array.from({ length: sides }, (_, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / sides;
    return Vec2(rOut * Math.cos(theta), rOut * Math.sin(theta));
  });
}

function makeRhombusVertices(acuteDeg: number): Vec2[] {
  const halfRad = ((acuteDeg / 2) * Math.PI) / 180;
  const dx = UNIT * Math.sin(halfRad);
  const dy = UNIT * Math.cos(halfRad);
  // Clockwise in SVG screen coordinates (y down): top (acute), right (obtuse), bottom (acute), left (obtuse)
  return [Vec2(0, -dy), Vec2(dx, 0), Vec2(0, dy), Vec2(-dx, 0)];
}

function createShapeDef(id: ShapeId, kind: "regular" | "rhombus", param: number, order: number): ShapeDef {
  const vertices = kind === "regular" ? makeRegularVertices(param) : makeRhombusVertices(param);
  const boundingRadius = Math.max(...vertices.map((v) => v.len()));
  // A regular polygon has all edges equivalent by rotational symmetry (only edge 0 needed).
  // A non-square rhombus has 2 distinct edge orientations relative to its acute/obtuse vertices (edge 0: acute->obtuse, edge 1: obtuse->acute).
  const uniqueEdgeIndices = kind === "regular" ? [0] : [0, 1];
  return { id, kind, order, vertices, uniqueEdgeIndices, boundingRadius };
}

const ALL_SHAPE_DEFS: ShapeDef[] = [
  createShapeDef("reg-3", "regular", 3, 1),
  createShapeDef("reg-4", "regular", 4, 2),
  createShapeDef("reg-5", "regular", 5, 3),
  createShapeDef("reg-6", "regular", 6, 4),
  createShapeDef("reg-8", "regular", 8, 5),
  createShapeDef("reg-10", "regular", 10, 6),
  createShapeDef("reg-12", "regular", 12, 7),
  createShapeDef("rhombus-30", "rhombus", 30, 8),
  createShapeDef("rhombus-36", "rhombus", 36, 9),
  createShapeDef("rhombus-45", "rhombus", 45, 10),
  createShapeDef("rhombus-60", "rhombus", 60, 11),
  createShapeDef("rhombus-72", "rhombus", 72, 12),
];

const SHAPE_DEF_MAP: Record<ShapeId, ShapeDef> = Object.fromEntries(ALL_SHAPE_DEFS.map((d) => [d.id, d])) as Record<ShapeId, ShapeDef>;

type PlacedShape = {
  id: string;
  type: ShapeId;
  x: number;
  y: number;
  angle: number;
};

type State = {
  shapes: PlacedShape[];
  availableTypes: ShapeId[];
  nextId: Record<string, number>;
  sketchPoints: Vec2[];
};

function getLocalVertices(type: ShapeId): Vec2[] {
  return SHAPE_DEF_MAP[type].vertices;
}

function getPolygonPoints(type: ShapeId): string {
  return getLocalVertices(type)
    .map((v) => `${v.x},${v.y}`)
    .join(" ");
}

function getWorldVertices(shape: PlacedShape): Vec2[] {
  const center = Vec2(shape.x, shape.y);
  return getLocalVertices(shape.type).map((v) => center.add(v.rotateDeg(shape.angle)));
}

type Edge = {
  a: Vec2;
  b: Vec2;
};

function getWorldEdges(shape: PlacedShape): Edge[] {
  const verts = getWorldVertices(shape);
  return verts.map((a, i) => ({
    a,
    b: verts[(i + 1) % verts.length],
  }));
}

function sameEdge(e1: Edge, e2: Edge): boolean {
  return (e1.a.dist(e2.a) < EPS && e1.b.dist(e2.b) < EPS) || (e1.a.dist(e2.b) < EPS && e1.b.dist(e2.a) < EPS);
}

function getBoundaryEdges(existingShapes: PlacedShape[]): Edge[] {
  const allEdges = existingShapes.flatMap(getWorldEdges);
  return allEdges.filter((e1, i) => !allEdges.some((e2, j) => i !== j && sameEdge(e1, e2)));
}

// Compute placement (x, y, angle) of a new shape of `type` so its local `edgeIdx` goes from `b` to `a`
// (opposite direction of boundary edge a -> b, so the new polygon sits on the outside of a -> b).
function placeShapeOnEdge(type: ShapeId, edgeIdx: number, edge: Edge, id: string): PlacedShape {
  const localVerts = getLocalVertices(type);
  const v0 = localVerts[edgeIdx];
  const v1 = localVerts[(edgeIdx + 1) % localVerts.length];
  const localDir = v1.sub(v0);
  // We want v0 -> v1 in world space to match edge.b -> edge.a
  const targetDir = edge.a.sub(edge.b);
  const angle = targetDir.angleDeg() - localDir.angleDeg();
  const rotatedV0 = v0.rotateDeg(angle);
  const center = edge.b.sub(rotatedV0);
  return {
    id,
    type,
    x: center.x,
    y: center.y,
    angle: ((angle % 360) + 360) % 360,
  };
}

// Separating Axis Theorem (SAT) for convex polygon interior overlap
function polygonsOverlapInterior(vertsA: Vec2[], vertsB: Vec2[]): boolean {
  for (const verts of [vertsA, vertsB]) {
    for (let i = 0; i < verts.length; i++) {
      const axis = verts[(i + 1) % verts.length].sub(verts[i]).perp().norm();
      const projA = vertsA.map((v) => v.dot(axis));
      const projB = vertsB.map((v) => v.dot(axis));
      if (Math.max(...projA) <= Math.min(...projB) + EPS || Math.max(...projB) <= Math.min(...projA) + EPS) {
        return false;
      }
    }
  }
  return true;
}

function samePolygonPlacement(vertsA: Vec2[], vertsB: Vec2[]): boolean {
  if (vertsA.length !== vertsB.length) return false;
  return vertsA.every((va) => vertsB.some((vb) => va.dist(vb) < EPS));
}

// Compute all valid candidate placements for a shape of `type` adjacent to `existingShapes`
function getValidPlacements(existingShapes: PlacedShape[], type: ShapeId, id: string, boundaryEdges = getBoundaryEdges(existingShapes)): PlacedShape[] {
  const def = SHAPE_DEF_MAP[type];
  const existingVerts = existingShapes.map(getWorldVertices);
  const candidates: { shape: PlacedShape; verts: Vec2[] }[] = [];

  for (const edge of boundaryEdges) {
    for (const edgeIdx of def.uniqueEdgeIndices) {
      const candidate = placeShapeOnEdge(type, edgeIdx, edge, id);
      const candVerts = getWorldVertices(candidate);
      if (existingVerts.some((verts) => polygonsOverlapInterior(candVerts, verts))) {
        continue;
      }
      if (!candidates.some((c) => samePolygonPlacement(c.verts, candVerts))) {
        candidates.push({ shape: candidate, verts: candVerts });
      }
    }
  }
  return candidates.map((c) => c.shape);
}

// Procedurally discover shapes from the minimalist tiling set that snugly fit into any open wedge
// formed by two adjacent boundary edges (sharing at least 2 boundary edges without overlap).
function computeUpdatedPalette(shapes: PlacedShape[], currentAvailable: ShapeId[]): ShapeId[] {
  const boundaryEdges = getBoundaryEdges(shapes);
  const discovered = new Set<ShapeId>(currentAvailable);

  for (const def of ALL_SHAPE_DEFS) {
    if (discovered.has(def.id)) continue;
    const placements = getValidPlacements(shapes, def.id, `probe-${def.id}`, boundaryEdges);
    const fitsWedge = placements.some((cand) => {
      const candEdges = getWorldEdges(cand);
      let sharedCount = 0;
      for (const ce of candEdges) {
        if (boundaryEdges.some((be) => sameEdge(ce, be))) {
          sharedCount++;
        }
      }
      return sharedCount >= 2;
    });
    if (fitsWedge) {
      discovered.add(def.id);
    }
  }

  return Array.from(discovered).sort((a, b) => SHAPE_DEF_MAP[a].order - SHAPE_DEF_MAP[b].order);
}

function finalizePlacedState(previewState: State): State {
  const nextAvailable = computeUpdatedPalette(previewState.shapes, previewState.availableTypes);
  const updatedNextId = { ...previewState.nextId };
  for (const s of nextAvailable) {
    if (!(s in updatedNextId)) {
      updatedNextId[s] = 1;
    }
  }
  return {
    ...previewState,
    availableTypes: nextAvailable,
    nextId: updatedNextId,
    sketchPoints: [],
  };
}

// Compute all valid candidate placements across available shape types for the current canvas state.
function getAllAvailablePlacements(state: State): PlacedShape[] {
  const boundaryEdges = getBoundaryEdges(state.shapes);
  const allValid: PlacedShape[] = [];

  for (const type of state.availableTypes) {
    const count = state.nextId[type] ?? 1;
    const id = `shape-${type}-${count}`;
    const placements =
      state.shapes.length === 0 ? [{ id, type, x: CANVAS_CENTER.x, y: CANVAS_CENTER.y, angle: 0 }] : getValidPlacements(state.shapes, type, id, boundaryEdges);
    allValid.push(...placements);
  }
  return allValid;
}

// Dynamically filter to the placements that are possible at the sketched location
// (reusing the same SNAP_GAP proximity check as drag-and-drop), then build $1 templates for them.
function getDynamicTemplatesForLocation(state: State, location: Vec2): { templates: GestureTemplate<PlacedShape>[]; nearbyPlacements: PlacedShape[] } {
  const allPlacements = getAllAvailablePlacements(state);
  if (allPlacements.length === 0) return { templates: [], nearbyPlacements: [] };

  let nearbyPlacements = allPlacements.filter((p) => Vec2(p.x, p.y).dist(location) <= SNAP_GAP);

  // If the canvas is empty, allow sketching anywhere on the canvas to place the first shape at CANVAS_CENTER.
  if (state.shapes.length === 0) {
    nearbyPlacements = allPlacements;
  } else if (nearbyPlacements.length === 0) {
    // If no placement is strictly within SNAP_GAP, select the closest valid location(s) and any placements sharing that spot
    let minDist = +Infinity;
    for (const p of allPlacements) {
      const d = Vec2(p.x, p.y).dist(location);
      if (d < minDist) minDist = d;
    }
    if (minDist <= SNAP_GAP * 2.5) {
      nearbyPlacements = allPlacements.filter((p) => Vec2(p.x, p.y).dist(location) <= minDist + UNIT * 0.75);
    }
  }

  const templates: GestureTemplate<PlacedShape>[] = [];
  for (const placed of nearbyPlacements) {
    const worldVerts = getWorldVertices(placed);
    templates.push(...makePolygonStrokeTemplates(worldVerts, placed.type, placed));
  }

  return { templates, nearbyPlacements };
}

const CANVAS_CENTER = { x: 450, y: 300 };

function getPaletteItemTransform(index: number, total: number, type: ShapeId): { x: number; y: number; scaleFactor: number } {
  const x = 80;
  const topMargin = 65;
  const bottomMargin = 535;
  const spacing = total <= 1 ? 0 : Math.min(105, (bottomMargin - topMargin) / (total - 1));
  const y = total <= 1 ? 120 : topMargin + index * spacing;
  const rOut = SHAPE_DEF_MAP[type].boundingRadius;
  const maxRadius = Math.min(44, spacing > 0 ? spacing * 0.42 : 44);
  const scaleFactor = rOut > maxRadius ? maxRadius / rOut : 1;
  return { x, y, scaleFactor };
}

const sculptureDraggable: Draggable<State> = ({ state, d, draggedId }) => {
  const sketchCenter = state.sketchPoints.length >= 2 ? centroid(state.sketchPoints) : null;
  const dynamicMatch =
    state.sketchPoints.length >= 4 && sketchCenter
      ? (() => {
          const { templates, nearbyPlacements } = getDynamicTemplatesForLocation(state, sketchCenter);
          const recognized = recognizeDollar1(state.sketchPoints, templates);
          return { recognized, nearbyPlacements };
        })()
      : null;

  return (
    <g>
      {/* Background surface for sketching on the canvas */}
      <rect
        id="sketch-surface"
        transform={translate(160, 0)}
        width={640}
        height={600}
        fill="transparent"
        style={{ cursor: "crosshair" }}
        dragologyOnDrag={() => {
          const pts: Vec2[] = [];
          return d
            .custom((ctx) => (frame) => {
              if (pts.length === 0 || pts[pts.length - 1].dist(frame.pointer) > 2) {
                pts.push(frame.pointer);
              }

              const liveState: State = {
                ...state,
                sketchPoints: [...pts],
              };

              let dropState: State = { ...state, sketchPoints: [] };
              if (pts.length >= 4 && pathLength(pts) > 20) {
                const center = centroid(pts);
                const { templates } = getDynamicTemplatesForLocation(state, center);
                const match = recognizeDollar1(pts, templates);
                if (match) {
                  const placed = match.template.payload;
                  const count = state.nextId[placed.type] ?? 1;
                  dropState = finalizePlacedState({
                    shapes: [...state.shapes, placed],
                    availableTypes: state.availableTypes,
                    nextId: { ...state.nextId, [placed.type]: count + 1 },
                    sketchPoints: [],
                  });
                }
              }

              return {
                preview: () => renderStateReadOnly(ctx, liveState),
                dropState,
                gap: 0,
              };
            })
            .withDropTransition(false);
        }}
      />

      <line x1={160} y1={0} x2={160} y2={600} stroke="black" />

      {/* Placed Shapes */}
      {state.shapes.map((shape) => (
        <g
          id={shape.id}
          transform={translate(shape.x, shape.y) + rotateDeg(shape.angle)}
          dragologyZIndex={draggedId === shape.id ? "/1" : 0}
          style={{ pointerEvents: "none" }}
        >
          <polygon points={getPolygonPoints(shape.type)} fill="white" stroke="black" vectorEffect="non-scaling-stroke" />
        </g>
      ))}

      {/* Live preview of candidate ghost placement while sketching */}
      {dynamicMatch?.recognized && (
        <g
          id="sketch-ghost-best"
          transform={
            translate(dynamicMatch.recognized.template.payload.x, dynamicMatch.recognized.template.payload.y) +
            rotateDeg(dynamicMatch.recognized.template.payload.angle)
          }
          style={{ pointerEvents: "none" }}
        >
          <polygon
            points={getPolygonPoints(dynamicMatch.recognized.template.payload.type)}
            fill="none"
            stroke="black"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}

      {/* User's active sketch stroke */}
      {state.sketchPoints.length >= 2 && (
        <polyline
          id="active-sketch-stroke"
          points={state.sketchPoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="#d00000"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Palette Items */}
      {state.availableTypes.map((type, idx) => {
        const { x, y, scaleFactor } = getPaletteItemTransform(idx, state.availableTypes.length, type);
        const count = state.nextId[type] ?? 1;
        const id = `shape-${type}-${count}`;
        const isDragged = draggedId === id;

        return (
          <g
            id={id}
            transform={translate(x, y) + rotateDeg(0) + scale(isDragged ? 1 : scaleFactor)}
            dragologyZIndex={isDragged ? "/1" : 0}
            dragologyOnDrag={() => {
              const validTargets =
                state.shapes.length === 0 ? [{ id, type, x: CANVAS_CENTER.x, y: CANVAS_CENTER.y, angle: 0 }] : getValidPlacements(state.shapes, type, id);

              const targetStates: State[] = validTargets.map((placed) => ({
                shapes: [...state.shapes, placed],
                availableTypes: state.availableTypes,
                nextId: { ...state.nextId, [type]: count + 1 },
                sketchPoints: [],
              }));

              const overlay = (
                <g>
                  {validTargets.map((t, i) => (
                    <g id={`ghost-${i}`} transform={translate(t.x, t.y) + rotateDeg(t.angle)}>
                      <polygon points={getPolygonPoints(t.type)} fill="none" stroke="black" strokeDasharray="4 4" />
                    </g>
                  ))}
                </g>
              );

              return d.closest(targetStates).whenFar(state, { gap: SNAP_GAP }).withFloating().withOverlay(overlay).onDrop(finalizePlacedState);
            }}
          >
            <polygon points={getPolygonPoints(type)} fill="white" stroke="black" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </g>
  );
};

const initialState: State = {
  shapes: [],
  availableTypes: ["reg-3", "reg-4"],
  nextId: { "reg-3": 1, "reg-4": 1 },
  sketchPoints: [],
};

export function App() {
  const [state, setState] = useState<State>(initialState);

  return <DraggableRenderer draggable={sculptureDraggable} state={state} onDropState={setState} width={800} height={600} />;
}

export default App;
