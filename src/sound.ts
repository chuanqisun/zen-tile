import backgroundMusicUrl from "./assets/background-music.mp3";
import drawingUrl from "./assets/drawing.mp3";
import fill1Url from "./assets/fill-01.mp3";
import fill2Url from "./assets/fill-02.mp3";
import fill3Url from "./assets/fill-03.mp3";
import drop1Url from "./assets/drop-01.mp3";
import drop2Url from "./assets/drop-02.mp3";
import drop3Url from "./assets/drop-03.mp3";

/**
 * Sound engine. Short effects go through the Web Audio API, so any number can overlap and they start with
 * low latency; the long music track streams through an <audio> element instead of being decoded to memory.
 *
 * Three modes: "off" (silence), "sfx" (effects only), and "all" (effects + music). Defaults to "all", and the
 * user's choice is remembered. The first user gesture starts it (browsers block audio before then). Nothing
 * is downloaded while sound is off, and the music isn't fetched unless it's wanted.
 */

const STORAGE_KEY = "sound";
const MUSIC_VOLUME = 0.35;
const SFX_VOLUME = 0.8;
const DRAWING_VOLUME = 0.5;
const DRAWING_IDLE_MS = 140; // the scratching stops when the pen stops moving
const FADE_S = 0.12;
const FILL_FADE_S = 0.1;
// A placed tile sounds one way when sketched (fill) and another when dragged in (drop).
const PLACED_URLS = {
  fill: [fill1Url, fill2Url, fill3Url],
  drop: [drop1Url, drop2Url, drop3Url],
};
export type PlacedKind = keyof typeof PLACED_URLS;

type Listener = () => void;

export type SoundMode = "off" | "sfx" | "all";
export const SOUND_MODES: SoundMode[] = ["off", "sfx", "all"];

const readMode = (): SoundMode => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "off" || stored === "sfx") return stored;
  return "all"; // the default, and the old "on" value
};

// Browsers refuse to play audio until a gesture, so nothing starts (or loads) until `unlock` runs on the
// first interaction.
let mode: SoundMode = readMode();
let enabled = mode !== "off"; // effects play
let musicEnabled = mode === "all";
const listeners = new Set<Listener>();

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

const getContext = () => {
  ctx ??= new AudioContext();
  return ctx;
};

const loadBuffer = (url: string) => {
  let pending = buffers.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => getContext().decodeAudioData(data));
    buffers.set(url, pending);
    pending.catch(() => buffers.delete(url)); // allow a retry
  }
  return pending;
};

// ---- music -----------------------------------------------------------------------------------------------

let music: HTMLAudioElement | null = null;

const startMusic = () => {
  if (!music) {
    music = new Audio(backgroundMusicUrl);
    music.loop = true;
    music.volume = MUSIC_VOLUME;
  }
  music.play().catch(() => {}); // blocked until a user gesture; `unlock` retries
};

const stopMusic = () => music?.pause();

// ---- drawing loop ----------------------------------------------------------------------------------------

let drawing: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let drawingWanted = false;
let drawingIdleTimer: ReturnType<typeof setTimeout> | undefined;

const stopDrawingNow = () => {
  drawingWanted = false;
  clearTimeout(drawingIdleTimer);
  if (!drawing || !ctx) return;

  const { source, gain } = drawing;
  drawing = null;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_S);
  source.stop(ctx.currentTime + FADE_S + 0.02);
};

const startDrawingNow = async () => {
  drawingWanted = true;
  const buffer = await loadBuffer(drawingUrl).catch(() => null);
  if (!buffer || !drawingWanted || !enabled || drawing) return;

  const c = getContext();
  const source = c.createBufferSource();
  const gain = c.createGain();
  source.buffer = buffer;
  source.loop = true;
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(DRAWING_VOLUME, c.currentTime + FADE_S);
  source.connect(gain).connect(c.destination);
  source.start();
  drawing = { source, gain };
};

// ---- public API ------------------------------------------------------------------------------------------

const lastPlaced: Record<PlacedKind, number> = { fill: -1, drop: -1 };
let preloaded = false;

export const sound = {
  getMode: () => mode,

  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Call from a user gesture (the toggle). */
  setMode(next: SoundMode) {
    mode = next;
    enabled = next !== "off";
    musicEnabled = next === "all";
    localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((l) => l());

    if (!musicEnabled) stopMusic();
    if (!enabled) stopDrawingNow();
    sound.unlock();
  },

  /**
   * Call on user gestures. The first one starts the music and preloads the effects (browsers refuse before
   * then); later calls retry only if something was blocked or paused.
   */
  unlock() {
    if (!enabled) return;
    const c = getContext();
    if (c.state !== "running") c.resume();
    if (musicEnabled && music?.paused !== false) startMusic();
    if (!preloaded) {
      preloaded = true;
      [...PLACED_URLS.fill, ...PLACED_URLS.drop, drawingUrl].forEach((url) => loadBuffer(url).catch(() => {}));
    }
  },

  /** Call on every pen movement while drawing; the loop fades out shortly after movement stops. */
  drawingActivity() {
    if (!enabled) return;
    if (!drawing && !drawingWanted) void startDrawingNow();
    clearTimeout(drawingIdleTimer);
    drawingIdleTimer = setTimeout(stopDrawingNow, DRAWING_IDLE_MS);
  },

  stopDrawing: stopDrawingNow,

  /** A random sound of the given kind, never the same one twice in a row. Overlaps with anything already playing. */
  async playPlaced(kind: PlacedKind) {
    if (!enabled) return;
    const urls = PLACED_URLS[kind];
    let i = Math.floor(Math.random() * urls.length);
    if (i === lastPlaced[kind]) i = (i + 1 + Math.floor(Math.random() * (urls.length - 1))) % urls.length;
    lastPlaced[kind] = i;

    const buffer = await loadBuffer(urls[i]).catch(() => null);
    if (!buffer || !enabled) return;

    const c = getContext();
    const source = c.createBufferSource();
    const gain = c.createGain();
    source.buffer = buffer;
    // Fade out over the last FILL_FADE_S of the clip.
    const end = c.currentTime + buffer.duration;
    const fadeStart = Math.max(c.currentTime, end - FILL_FADE_S);
    gain.gain.setValueAtTime(SFX_VOLUME, c.currentTime);
    gain.gain.setValueAtTime(SFX_VOLUME, fadeStart);
    gain.gain.linearRampToValueAtTime(0, end);
    source.connect(gain).connect(c.destination);
    source.start();
  },

  /** Music is the only thing worth pausing when the tab is hidden. */
  setHidden(hidden: boolean) {
    if (!musicEnabled) return;
    if (hidden) stopMusic();
    else startMusic();
  },
};
