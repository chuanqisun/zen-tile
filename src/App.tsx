import { type Draggable, DraggableRenderer, renderStateReadOnly, rotateDeg, scale, translate, Vec2 } from "dragology";
import { useEffect, useState } from "react";
import "./App.css";
import { getHandDrawnPaths } from "./handdrawn";
import { getTileFill, TilePatternDefs } from "./patterns";
import { makePolygonStrokeTemplates, pathLength, recognizeDollar1 } from "./dollar1";
import {
  computeUpdatedPalette,
  getBoundaryEdges,
  getPolygonPoints,
  getLocalVertices,
  getValidPlacements,
  getWorldEdges,
  getWorldVertices,
  type PlacedShape,
  SHAPE_DEF_MAP,
  sameEdge,
  type ShapeId,
} from "./tiling";

const SNAP_GAP = 60;
const PALETTE_WIDTH = 160;

type Viewport = {
  width: number;
  height: number;
};

type State = {
  shapes: PlacedShape[];
  availableTypes: ShapeId[];
  nextId: Record<string, number>;
  sketchPoints: Vec2[];
  viewport: Viewport;
};

const getCanvasCenter = ({ width, height }: Viewport) => ({
  x: PALETTE_WIDTH + (width - PALETTE_WIDTH) / 2,
  y: height / 2,
});

const getPlacementsForType = (state: State, type: ShapeId, boundaryEdges = getBoundaryEdges(state.shapes)): PlacedShape[] => {
  const id = `shape-${type}-${state.nextId[type] ?? 1}`;
  const center = getCanvasCenter(state.viewport);

  if (state.shapes.length === 0) return [{ id, type, x: center.x, y: center.y, angle: 0 }];

  return getValidPlacements(state.shapes, type, id, boundaryEdges).map((placed) => ({
    ...placed,
    shared: getWorldEdges(placed).map((edge) => boundaryEdges.some((b) => sameEdge(edge, b))),
  }));
};

const applyPlacedShape = (state: State, placed: PlacedShape) => ({
  ...state,
  shapes: [...state.shapes, placed],
  nextId: { ...state.nextId, [placed.type]: (state.nextId[placed.type] ?? 1) + 1 },
  sketchPoints: [],
});

const finalizePlacedState = (state: State) => {
  const availableTypes = computeUpdatedPalette(state.shapes, state.availableTypes);
  const nextId = { ...state.nextId };

  for (const type of availableTypes) {
    nextId[type] ??= 1;
  }

  return {
    ...state,
    availableTypes,
    nextId,
    sketchPoints: [],
  };
};

const buildCanvasTemplates = (state: State) => {
  const boundaryEdges = getBoundaryEdges(state.shapes);
  const allPlacements = state.availableTypes.flatMap((type) => getPlacementsForType(state, type, boundaryEdges));

  // Edges coinciding with the current boundary already exist, so the user may skip drawing them.
  return allPlacements.flatMap((placed) => makePolygonStrokeTemplates(getWorldVertices(placed), placed.type, placed, placed.shared));
};

// Templates depend only on these fields, not on sketchPoints, so one entry is reused for every
// pointer move and render of a sketch (each frame's `{ ...state, sketchPoints }` keeps these refs).
let templateCache: {
  key: [State["shapes"], State["availableTypes"], State["nextId"], State["viewport"]];
  templates: ReturnType<typeof buildCanvasTemplates>;
} | null = null;

const getCanvasTemplates = (state: State) => {
  const key: NonNullable<typeof templateCache>["key"] = [state.shapes, state.availableTypes, state.nextId, state.viewport];

  if (!templateCache || templateCache.key.some((ref, i) => ref !== key[i])) {
    templateCache = { key, templates: buildCanvasTemplates(state) };
  }

  return templateCache.templates;
};

const getPaletteItemTransform = (index: number, total: number, type: ShapeId, viewportHeight: number) => {
  const x = PALETTE_WIDTH / 2;
  const topMargin = 65;
  const bottomMargin = Math.max(topMargin + 100, viewportHeight - 65);
  const spacing = total <= 1 ? 0 : Math.min(105, (bottomMargin - topMargin) / (total - 1));
  const y = total <= 1 ? 120 : topMargin + index * spacing;
  const { boundingRadius } = SHAPE_DEF_MAP[type];
  const maxRadius = Math.min(44, spacing > 0 ? spacing * 0.42 : 44);
  const scaleFactor = boundingRadius > maxRadius ? maxRadius / boundingRadius : 1;

  return { x, y, scaleFactor };
};

const recognizeSketchPlacement = (state: State, points: Vec2[]) => {
  if (points.length < 4) return null;
  const templates = getCanvasTemplates(state);
  return recognizeDollar1(points, templates, SNAP_GAP)?.template.payload ?? null;
};

const sculptureDraggable: Draggable<State> = ({ state, d, draggedId }) => {
  const { width: viewW, height: viewH } = state.viewport;
  const previewPlacement = recognizeSketchPlacement(state, state.sketchPoints);

  return (
    <g>
      <rect
        id="sketch-surface"
        transform={translate(PALETTE_WIDTH, 0)}
        width={Math.max(0, viewW - PALETTE_WIDTH)}
        height={viewH}
        fill="transparent"
        style={{ cursor: "crosshair" }}
        dragologyOnDrag={() => {
          const pts: Vec2[] = [];

          return d
            .custom((ctx) => (frame) => {
              if (pts.length === 0 || pts[pts.length - 1].dist(frame.pointer) > 2) {
                pts.push(frame.pointer);
              }

              const liveState = { ...state, sketchPoints: [...pts] };
              const matched = pathLength(pts) > 20 ? recognizeSketchPlacement(state, pts) : null;
              const dropState = matched ? finalizePlacedState(applyPlacedShape(state, matched)) : { ...state, sketchPoints: [] };

              return {
                preview: () => renderStateReadOnly(ctx, liveState),
                dropState,
                gap: 0,
              };
            })
            .withDropTransition(false);
        }}
      />

      <line x1={PALETTE_WIDTH} y1={0} x2={PALETTE_WIDTH} y2={viewH} stroke="black" />

      {state.shapes.map((shape, i) => {
        const paths = getHandDrawnPaths(getLocalVertices(shape.type), shape.id, shape.shared);
        return (
          <g
            id={shape.id}
            transform={translate(shape.x, shape.y) + rotateDeg(shape.angle)}
            // Older tiles sit above newer ones, so existing edges win over a new tile's straight shared edge.
            dragologyZIndex={draggedId === shape.id ? "/1" : -i}
            style={{ pointerEvents: "none" }}
          >
            <path d={paths.fill} fill={getTileFill(shape.id)} />
            <path d={paths.stroke} fill="none" stroke="black" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}

      {previewPlacement && (
        <g
          id="sketch-ghost-best"
          transform={translate(previewPlacement.x, previewPlacement.y) + rotateDeg(previewPlacement.angle)}
          style={{ pointerEvents: "none" }}
        >
          <polygon points={getPolygonPoints(previewPlacement.type)} fill="none" stroke="black" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        </g>
      )}

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

      {state.availableTypes.map((type, idx) => {
        const { x, y, scaleFactor } = getPaletteItemTransform(idx, state.availableTypes.length, type, viewH);
        const id = `shape-${type}-${state.nextId[type] ?? 1}`;
        const isDragged = draggedId === id;

        return (
          <g
            id={id}
            transform={translate(x, y) + rotateDeg(0) + scale(isDragged ? 1 : scaleFactor)}
            dragologyZIndex={isDragged ? "/1" : 0}
            dragologyOnDrag={() => {
              const validTargets = getPlacementsForType(state, type);
              const targetStates = validTargets.map((placed) => applyPlacedShape(state, placed));

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
            <path d={getHandDrawnPaths(getLocalVertices(type), id).fill} fill={getTileFill(id)} />
            <path
              d={getHandDrawnPaths(getLocalVertices(type), id).stroke}
              fill="none"
              stroke="black"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </g>
  );
};

export function App() {
  const [state, setState] = useState<State>(() => ({
    shapes: [],
    availableTypes: ["reg-3"],
    nextId: { "reg-3": 1 },
    sketchPoints: [],
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }));

  useEffect(() => {
    const handleResize = () => {
      const nextViewport = { width: window.innerWidth, height: window.innerHeight };
      setState((prev) => {
        const oldCenter = getCanvasCenter(prev.viewport);
        const newCenter = getCanvasCenter(nextViewport);
        const dx = newCenter.x - oldCenter.x;
        const dy = newCenter.y - oldCenter.y;

        return {
          ...prev,
          viewport: nextViewport,
          shapes: prev.shapes.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
          sketchPoints: prev.sketchPoints.map((p) => Vec2(p.x + dx, p.y + dy)),
        };
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <>
      <TilePatternDefs
        tiles={[
          ...state.shapes,
          ...state.availableTypes.map((type) => ({
            id: `shape-${type}-${state.nextId[type] ?? 1}`,
            type,
          })),
        ]}
      />
      <DraggableRenderer draggable={sculptureDraggable} state={state} onDropState={setState} width={state.viewport.width} height={state.viewport.height} />
    </>
  );
}

export default App;
