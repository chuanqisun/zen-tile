import {
  type Draggable,
  DraggableRenderer,
  type DragFrame,
  type DragInitContext,
  type DragSpecData,
  Modifier,
  modifier,
  renderStateReadOnly,
  rotateDeg,
  scale,
  translate,
  Vec2,
} from "dragology";
import { useEffect, useState, useSyncExternalStore } from "react";
import "./App.css";
import { INK, type Theme } from "./theme";
import { sound } from "./sound";
import { TilePatternDefs } from "./patterns";
import { TileBody } from "./TileBody";
import { makePolygonStrokeTemplates, pathLength, recognizeDollar1 } from "./dollar1";
import {
  computeUpdatedPalette,
  getBoundaryEdges,
  getPolygonPoints,
  getValidPlacements,
  getWorldEdges,
  getWorldVertices,
  type PlacedShape,
  SHAPE_DEF_MAP,
  sameEdge,
  type ShapeId,
} from "./tiling";

const SNAP_GAP = 60;
// Animate the dragged tile (e.g. its rotation) when the closest target changes, instead of snapping.
const BRANCH_MS = 150;

/** Palette tiles start at angle 0, so use the equivalent angle in (-180, 180]: transitions turn the short way round. */
const shortestAngle = (deg: number) => {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
};

type PointerSink = { current: Vec2 | null };

/** Records the latest pointer for the wrapped spec's callbacks (e.g. `reactTo` getters, which get no frame). */
class TrackPointer<T extends object> extends Modifier<T> {
  readonly name = "trackPointer";
  readonly sink: PointerSink;

  constructor(ctx: DragInitContext<T>, inner: DragSpecData<T>, sink: PointerSink) {
    super(ctx, inner);
    this.sink = sink;
  }

  frame(frame: DragFrame) {
    this.sink.current = frame.pointer;
    return this.inner.run(frame);
  }
}
const trackPointer = modifier(TrackPointer);
// Bottom strip, in the thumb zone. Tiles wrap to two rows on narrow screens.
const PALETTE_HEIGHT = 132;

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
  x: width / 2,
  y: (height - PALETTE_HEIGHT) / 2,
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

const getPaletteItemTransform = (index: number, total: number, type: ShapeId, { width, height }: Viewport) => {
  const margin = 24;
  const minSpacing = 68;
  const rows = total * minSpacing > width - 2 * margin ? 2 : 1;
  const perRow = Math.ceil(total / rows);
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  const countInRow = Math.min(perRow, total - row * perRow); // the last row is centered
  const spacing = Math.min(100, (width - 2 * margin) / perRow);
  const rowHeight = PALETTE_HEIGHT / rows;

  const x = width / 2 + (col - (countInRow - 1) / 2) * spacing;
  const y = height - PALETTE_HEIGHT + rowHeight * (row + 0.5);
  const { boundingRadius } = SHAPE_DEF_MAP[type];
  const maxRadius = Math.min(44, spacing * 0.42, rowHeight * 0.42);
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
        width={viewW}
        height={Math.max(0, viewH - PALETTE_HEIGHT)}
        fill="transparent"
        style={{ cursor: "crosshair" }}
        dragologyOnDrag={() => {
          const pts: Vec2[] = [];

          return d
            .custom((ctx) => (frame) => {
              sound.drawingActivity();
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

      <line x1={0} y1={viewH - PALETTE_HEIGHT} x2={viewW} y2={viewH - PALETTE_HEIGHT} stroke={INK} />

      {state.shapes.map((shape, i) => {
        return (
          <g
            id={shape.id}
            transform={translate(shape.x, shape.y)}
            // Older tiles sit above newer ones, so existing edges win over a new tile's straight shared edge.
            dragologyZIndex={draggedId === shape.id ? "/1" : -i}
            style={{ pointerEvents: "none" }}
          >
            <TileBody tileId={shape.id} type={shape.type} shared={shape.shared} angle={shape.angle} animate={draggedId === shape.id} />
          </g>
        );
      })}

      {previewPlacement && (
        <g
          id="sketch-ghost-best"
          transform={translate(previewPlacement.x, previewPlacement.y) + rotateDeg(previewPlacement.angle)}
          style={{ pointerEvents: "none" }}
        >
          <polygon points={getPolygonPoints(previewPlacement.type)} fill="none" stroke={INK} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        </g>
      )}

      {state.sketchPoints.length >= 2 && (
        <polyline
          id="active-sketch-stroke"
          points={state.sketchPoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={INK}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      )}

      {state.availableTypes.map((type, idx) => {
        const { x, y, scaleFactor } = getPaletteItemTransform(idx, state.availableTypes.length, type, state.viewport);
        const id = `shape-${type}-${state.nextId[type] ?? 1}`;
        const isDragged = draggedId === id;

        return (
          <g
            id={id}
            transform={translate(x, y) + rotateDeg(0) + scale(isDragged ? 1 : scaleFactor)}
            dragologyZIndex={isDragged ? "/1" : 0}
            dragologyOnDrag={() => {
              const validTargets = getPlacementsForType(state, type);
              // Only targets near the pointer take part in the drag (previews, snapping, ghosts).
              // The margin covers the grab offset between the pointer and the dragged tile's center.
              const radius = SNAP_GAP + 2 * SHAPE_DEF_MAP[type].boundingRadius;
              const pointer: PointerSink = { current: null };
              const nearbyKey = () => {
                const p = pointer.current;
                return validTargets.flatMap((t, i) => (p && Vec2(t.x, t.y).dist(p) < radius ? [i] : [])).join(",");
              };

              return d
                .reactTo(nearbyKey, (key) => {
                  const nearby = key === "" ? [] : key.split(",").map((i) => ({ i: Number(i), placed: validTargets[Number(i)] }));
                  // Drag-and-drop places the full tile: drop the shared-edge marks so every edge is drawn.
                  // (Sketch placements keep them, since the user omits edges they consider implicit.)
                  const targetStates = nearby.length
                    ? nearby.map(({ placed }) => applyPlacedShape(state, { ...placed, angle: shortestAngle(placed.angle), shared: undefined }))
                    : [state];

                  const overlay = (
                    <g>
                      {nearby.map(({ i, placed: t }) => (
                        <g id={`ghost-${i}`} transform={translate(t.x, t.y) + rotateDeg(t.angle)}>
                          <polygon points={getPolygonPoints(t.type)} fill="none" stroke={INK} strokeDasharray="4 4" />
                        </g>
                      ))}
                    </g>
                  );

                  return d
                    .closest(targetStates)
                    .withBranchTransition(BRANCH_MS)
                    .whenFar(state, { gap: SNAP_GAP })
                    .withBranchTransition(BRANCH_MS)
                    .withFloating()
                    .withOverlay(overlay)
                    .onDrop(finalizePlacedState);
                })
                .with(trackPointer(pointer));
            }}
          >
            <TileBody tileId={id} type={type} angle={0} animate={isDragged} />
          </g>
        );
      })}
    </g>
  );
};

const getInitialTheme = (): Theme => (localStorage.getItem("theme") === "light" ? "light" : "dark");

function SoundToggle() {
  const on = useSyncExternalStore(sound.subscribe, sound.isEnabled);
  // Bars when sound is on, a flat row of dots when it's off.
  const bars = [4, 9, 6];

  return (
    <button className="icon-toggle sound-toggle" aria-label={on ? "Turn sound off" : "Turn sound on"} aria-pressed={on} onClick={() => sound.setEnabled(!on)}>
      <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden>
        {bars.map((h, i) =>
          on ? (
            <rect x={1 + i * 4} y={6 - h / 2} width={2} height={h} rx={1} fill="currentColor" />
          ) : (
            <circle cx={2 + i * 4} cy={6} r={1.1} fill="currentColor" />
          ),
        )}
      </svg>
    </button>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  return <button className="icon-toggle theme-toggle" aria-label="Toggle light/dark theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} />;
}

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

  // Sound: retry anything the browser blocked before the first gesture, stop the drawing loop when the pen lifts,
  // and pause the music while the tab is hidden.
  useEffect(() => {
    const unlock = () => sound.unlock();
    const stopDrawing = () => sound.stopDrawing();
    const onVisibility = () => sound.setHidden(document.hidden);

    window.addEventListener("pointerdown", unlock);
    window.addEventListener("pointerup", stopDrawing);
    window.addEventListener("pointercancel", stopDrawing);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("pointerup", stopDrawing);
      window.removeEventListener("pointercancel", stopDrawing);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Both drag-and-drop and sketching end here, so a new tile is where its sound plays.
  const handleDrop = (next: State) => {
    if (next.shapes.length > state.shapes.length) sound.playFill();
    setState(next);
  };

  // Mobile: no page zoom, scroll or context menu while drawing and dragging. CSS (touch-action) covers
  // most browsers; these cover Safari's pinch gestures and rubber-banding.
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    const opts = { passive: false } as const;
    const events = ["gesturestart", "gesturechange", "gestureend", "touchmove", "contextmenu", "dblclick"];
    for (const name of events) document.addEventListener(name, block, opts);
    return () => {
      for (const name of events) document.removeEventListener(name, block);
    };
  }, []);

  return (
    <>
      <SoundToggle />
      <ThemeToggle />
      <TilePatternDefs
        tiles={[
          ...state.shapes,
          ...state.availableTypes.map((type) => ({
            id: `shape-${type}-${state.nextId[type] ?? 1}`,
            type,
          })),
        ]}
      />
      <DraggableRenderer draggable={sculptureDraggable} state={state} onDropState={handleDrop} width={state.viewport.width} height={state.viewport.height} />
    </>
  );
}

export default App;
