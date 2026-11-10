import { Vec2 } from "dragology";

export const UNIT = 60;
const EPS = 0.5;

export type ShapeId =
  | "reg-3"
  | "reg-4"
  | "reg-5"
  | "reg-6"
  | "reg-8"
  | "reg-10"
  | "reg-12"
  | "rhombus-30"
  | "rhombus-36"
  | "rhombus-45"
  | "rhombus-60"
  | "rhombus-72";

export type PlacedShape = {
  id: string;
  type: ShapeId;
  x: number;
  y: number;
  angle: number;
  /** Per edge (vertex i -> i + 1): lies on an older tile at placement time. */
  shared?: boolean[];
  /** How the tile was placed, which decides the sound it makes. */
  placedBy?: "drag" | "sketch";
};

type Edge = {
  a: Vec2;
  b: Vec2;
};

const makeRegularVertices = (sides: number) => {
  const radius = UNIT / (2 * Math.sin(Math.PI / sides));
  return Array.from({ length: sides }, (_, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / sides;
    return Vec2(radius * Math.cos(theta), radius * Math.sin(theta));
  });
};

const makeRhombusVertices = (acuteDeg: number) => {
  const halfRad = ((acuteDeg / 2) * Math.PI) / 180;
  const dx = UNIT * Math.sin(halfRad);
  const dy = UNIT * Math.cos(halfRad);
  return [Vec2(0, -dy), Vec2(dx, 0), Vec2(0, dy), Vec2(-dx, 0)];
};

const createShapeDef = (id: ShapeId, kind: "regular" | "rhombus", param: number, order: number) => {
  const vertices = kind === "regular" ? makeRegularVertices(param) : makeRhombusVertices(param);
  return {
    id,
    kind,
    order,
    vertices,
    uniqueEdgeIndices: kind === "regular" ? [0] : [0, 1],
    boundingRadius: Math.max(...vertices.map((v) => v.len())),
  };
};

export const ALL_SHAPE_DEFS = [
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

export const SHAPE_DEF_MAP = Object.fromEntries(ALL_SHAPE_DEFS.map((d) => [d.id, d])) as Record<ShapeId, (typeof ALL_SHAPE_DEFS)[number]>;

export const getLocalVertices = (type: ShapeId) => SHAPE_DEF_MAP[type].vertices;

export const getPolygonPoints = (type: ShapeId) =>
  getLocalVertices(type)
    .map((v) => `${v.x},${v.y}`)
    .join(" ");

export const getWorldVertices = ({ type, x, y, angle }: PlacedShape) => {
  const center = Vec2(x, y);
  return getLocalVertices(type).map((v) => center.add(v.rotateDeg(angle)));
};

export const getWorldEdges = (shape: PlacedShape) => {
  const verts = getWorldVertices(shape);
  return verts.map((a, i) => ({ a, b: verts[(i + 1) % verts.length] }));
};

export const sameEdge = (e1: Edge, e2: Edge) => (e1.a.dist(e2.a) < EPS && e1.b.dist(e2.b) < EPS) || (e1.a.dist(e2.b) < EPS && e1.b.dist(e2.a) < EPS);

export const getBoundaryEdges = (shapes: PlacedShape[]) => {
  const allEdges = shapes.flatMap(getWorldEdges);
  return allEdges.filter((e1, i) => !allEdges.some((e2, j) => i !== j && sameEdge(e1, e2)));
};

const placeShapeOnEdge = (type: ShapeId, edgeIdx: number, edge: Edge, id: string) => {
  const localVerts = getLocalVertices(type);
  const v0 = localVerts[edgeIdx];
  const v1 = localVerts[(edgeIdx + 1) % localVerts.length];
  const angle = edge.a.sub(edge.b).angleDeg() - v1.sub(v0).angleDeg();
  const center = edge.b.sub(v0.rotateDeg(angle));

  return {
    id,
    type,
    x: center.x,
    y: center.y,
    angle: ((angle % 360) + 360) % 360,
  };
};

const polygonsOverlapInterior = (vertsA: Vec2[], vertsB: Vec2[]) =>
  [vertsA, vertsB].every((verts) =>
    verts.every((v, i) => {
      const axis = verts[(i + 1) % verts.length].sub(v).perp().norm();
      const projA = vertsA.map((p) => p.dot(axis));
      const projB = vertsB.map((p) => p.dot(axis));
      return Math.max(...projA) > Math.min(...projB) + EPS && Math.max(...projB) > Math.min(...projA) + EPS;
    }),
  );

const samePolygonPlacement = (vertsA: Vec2[], vertsB: Vec2[]) =>
  vertsA.length === vertsB.length && vertsA.every((va) => vertsB.some((vb) => va.dist(vb) < EPS));

export const getValidPlacements = (existingShapes: PlacedShape[], type: ShapeId, id: string, boundaryEdges = getBoundaryEdges(existingShapes)) => {
  const { uniqueEdgeIndices } = SHAPE_DEF_MAP[type];
  const existingVerts = existingShapes.map(getWorldVertices);
  const candidates: { shape: PlacedShape; verts: Vec2[] }[] = [];

  for (const edge of boundaryEdges) {
    for (const edgeIdx of uniqueEdgeIndices) {
      const shape = placeShapeOnEdge(type, edgeIdx, edge, id);
      const verts = getWorldVertices(shape);
      const overlaps = existingVerts.some((ev) => polygonsOverlapInterior(verts, ev));
      const duplicate = candidates.some((c) => samePolygonPlacement(c.verts, verts));

      if (!overlaps && !duplicate) {
        candidates.push({ shape, verts });
      }
    }
  }

  return candidates.map((c) => c.shape);
};

export const computeUpdatedPalette = (shapes: PlacedShape[], currentAvailable: ShapeId[]) => {
  const boundaryEdges = getBoundaryEdges(shapes);
  const discovered = new Set<ShapeId>(currentAvailable);

  if (shapes.some((s) => s.type === "reg-3")) {
    discovered.add("reg-4");
  }

  for (const { id } of ALL_SHAPE_DEFS) {
    if (discovered.has(id)) continue;

    const placements = getValidPlacements(shapes, id, `probe-${id}`, boundaryEdges);
    const fitsWedge = placements.some((cand) => {
      const sharedEdges = getWorldEdges(cand).filter((ce) => boundaryEdges.some((be) => sameEdge(ce, be)));
      return sharedEdges.length >= 2;
    });

    if (fitsWedge) {
      discovered.add(id);
    }
  }

  return [...discovered].sort((a, b) => SHAPE_DEF_MAP[a].order - SHAPE_DEF_MAP[b].order);
};
