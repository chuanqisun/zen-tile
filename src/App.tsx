import { type Draggable, DraggableRenderer, rotateDeg, scale, translate, Vec2 } from "dragology";
import { useState } from "react";
import "./App.css";

const UNIT = 60;
const EPS = 0.5;
const MAX_SIDES = 12;

type ShapeType = number; // number of sides of regular polygon (3 = triangle, 4 = square, 5 = pentagon, ...)

type PlacedShape = {
  id: string;
  sides: ShapeType;
  x: number;
  y: number;
  angle: number;
};

type State = {
  shapes: PlacedShape[];
  availableSides: ShapeType[];
  nextId: Record<ShapeType, number>;
};

function getLocalVertices(sides: ShapeType): Vec2[] {
  const rOut = UNIT / (2 * Math.sin(Math.PI / sides));
  return Array.from({ length: sides }, (_, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / sides;
    return Vec2(rOut * Math.cos(theta), rOut * Math.sin(theta));
  });
}

function getPolygonPoints(sides: ShapeType): string {
  return getLocalVertices(sides)
    .map((v) => `${v.x},${v.y}`)
    .join(" ");
}

function getWorldVertices(shape: PlacedShape): Vec2[] {
  const center = Vec2(shape.x, shape.y);
  return getLocalVertices(shape.sides).map((v) => center.add(v.rotateDeg(shape.angle)));
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

// Compute placement (x, y, angle) of a new shape of `sides` so its edge 0 goes from `b` to `a`
// (opposite direction of boundary edge a -> b, so the new polygon sits on the outside of a -> b).
function placeShapeOnEdge(sides: ShapeType, edge: Edge, id: string): PlacedShape {
  const localVerts = getLocalVertices(sides);
  const v0 = localVerts[0];
  const v1 = localVerts[1];
  const localDir = v1.sub(v0);
  // We want v0 -> v1 in world space to match edge.b -> edge.a
  const targetDir = edge.a.sub(edge.b);
  const angle = targetDir.angleDeg() - localDir.angleDeg();
  const rotatedV0 = v0.rotateDeg(angle);
  const center = edge.b.sub(rotatedV0);
  return {
    id,
    sides,
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

// Compute all valid candidate placements for a shape of `sides` adjacent to `existingShapes`
function getValidPlacements(existingShapes: PlacedShape[], sides: ShapeType, id: string, boundaryEdges = getBoundaryEdges(existingShapes)): PlacedShape[] {
  const existingVerts = existingShapes.map(getWorldVertices);
  const candidates: PlacedShape[] = [];

  for (const edge of boundaryEdges) {
    const candidate = placeShapeOnEdge(sides, edge, id);
    const candVerts = getWorldVertices(candidate);
    if (existingVerts.some((verts) => polygonsOverlapInterior(candVerts, verts))) {
      continue;
    }
    if (!candidates.some((c) => Math.hypot(c.x - candidate.x, c.y - candidate.y) < EPS)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

// Procedurally discover regular polygons (equal side lengths) that snugly fit into gaps/corners
// formed by the placed shapes (where placing the polygon shares at least 2 edges with the boundary).
function computeUpdatedPalette(shapes: PlacedShape[], currentAvailable: ShapeType[]): ShapeType[] {
  const boundaryEdges = getBoundaryEdges(shapes);
  const discovered = new Set<ShapeType>(currentAvailable);

  for (let sides = 3; sides <= MAX_SIDES; sides++) {
    if (discovered.has(sides)) continue;
    const placements = getValidPlacements(shapes, sides, `probe-${sides}`, boundaryEdges);
    const fitsGap = placements.some((cand) => {
      const candEdges = getWorldEdges(cand);
      let sharedCount = 0;
      for (const ce of candEdges) {
        if (boundaryEdges.some((be) => sameEdge(ce, be))) {
          sharedCount++;
        }
      }
      return sharedCount >= 2;
    });
    if (fitsGap) {
      discovered.add(sides);
    }
  }

  return Array.from(discovered).sort((a, b) => a - b);
}

const CANVAS_CENTER = { x: 450, y: 300 };

function getPaletteItemTransform(index: number, total: number, sides: ShapeType): { x: number; y: number; scaleFactor: number } {
  const x = 80;
  const topMargin = 70;
  const bottomMargin = 530;
  const spacing = total <= 1 ? 0 : Math.min(115, (bottomMargin - topMargin) / (total - 1));
  const y = total <= 1 ? 120 : topMargin + index * spacing;
  const rOut = UNIT / (2 * Math.sin(Math.PI / sides));
  const maxRadius = Math.min(48, spacing > 0 ? spacing * 0.42 : 48);
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
          <polygon points={getPolygonPoints(shape.sides)} fill="white" stroke="black" vectorEffect="non-scaling-stroke" />
        </g>
      ))}

      {/* Palette Items */}
      {state.availableSides.map((sides, idx) => {
        const { x, y, scaleFactor } = getPaletteItemTransform(idx, state.availableSides.length, sides);
        const count = state.nextId[sides] ?? 1;
        const id = `shape-${sides}-${count}`;
        const isDragged = draggedId === id;

        return (
          <g
            id={id}
            transform={translate(x, y) + rotateDeg(0) + scale(isDragged ? 1 : scaleFactor)}
            dragologyZIndex={isDragged ? "/1" : 0}
            dragologyOnDrag={() => {
              const validTargets =
                state.shapes.length === 0 ? [{ id, sides, x: CANVAS_CENTER.x, y: CANVAS_CENTER.y, angle: 0 }] : getValidPlacements(state.shapes, sides, id);

              const targetStates: State[] = validTargets.map((placed) => ({
                shapes: [...state.shapes, placed],
                availableSides: state.availableSides,
                nextId: { ...state.nextId, [sides]: count + 1 },
              }));

              const overlay = (
                <g>
                  {validTargets.map((t, i) => (
                    <g id={`ghost-${i}`} transform={translate(t.x, t.y) + rotateDeg(t.angle)}>
                      <polygon points={getPolygonPoints(t.sides)} fill="none" stroke="black" strokeDasharray="4 4" />
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
                  const nextAvailable = computeUpdatedPalette(previewState.shapes, previewState.availableSides);
                  const updatedNextId = { ...previewState.nextId };
                  for (const s of nextAvailable) {
                    if (!(s in updatedNextId)) {
                      updatedNextId[s] = 1;
                    }
                  }
                  return {
                    ...previewState,
                    availableSides: nextAvailable,
                    nextId: updatedNextId,
                  };
                });
            }}
          >
            <polygon points={getPolygonPoints(sides)} fill="white" stroke="black" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </g>
  );
};

const initialState: State = {
  shapes: [],
  availableSides: [3, 4],
  nextId: { 3: 1, 4: 1 },
};

export function App() {
  const [state, setState] = useState<State>(initialState);

  return <DraggableRenderer draggable={sculptureDraggable} state={state} onDropState={setState} width={800} height={600} />;
}

export default App;
