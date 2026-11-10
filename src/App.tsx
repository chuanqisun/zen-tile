import { type Draggable, DraggableRenderer, rotateDeg, scale, translate, Vec2 } from "dragology";
import { useState } from "react";
import "./App.css";

const UNIT = 60;
const EPS = 0.5;
const ANGLE_EPS = 1;

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

type ShapeId =
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
function getValidPlacements(
  existingShapes: PlacedShape[],
  type: ShapeId,
  id: string,
  boundaryEdges = getBoundaryEdges(existingShapes),
): PlacedShape[] {
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
  return (
    <g>
      <line x1={160} y1={0} x2={160} y2={600} stroke="black" />

      {/* Placed Shapes */}
      {state.shapes.map((shape) => (
        <g id={shape.id} transform={translate(shape.x, shape.y) + rotateDeg(shape.angle)} dragologyZIndex={draggedId === shape.id ? "/1" : 0}>
          <polygon points={getPolygonPoints(shape.type)} fill="white" stroke="black" vectorEffect="non-scaling-stroke" />
        </g>
      ))}

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

              return d
                .closest(targetStates)
                .whenFar(state, { gap: 60 })
                .withFloating()
                .withOverlay(overlay)
                .onDrop((previewState) => {
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
                  };
                });
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
};

export function App() {
  const [state, setState] = useState<State>(initialState);

  return <DraggableRenderer draggable={sculptureDraggable} state={state} onDropState={setState} width={800} height={600} />;
}

export default App;
