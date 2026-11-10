import backgroundMusicUrl from "./assets/background-music.mp3";
import drawingUrl from "./assets/drawing.mp3";
import fill1Url from "./assets/fill-01.mp3";
import fill2Url from "./assets/fill-02.mp3";
import fill3Url from "./assets/fill-03.mp3";

/**
 * Sound engine. Short effects go through the Web Audio API, so any number can overlap and they start with
 * low latency; the long music track streams through an <audio> element instead of being decoded to memory.
 *
 * Everything is off until the user turns sound on, and that preference is remembered. Nothing is downloaded
 * while sound is off.
 */

const STORAGE_KEY = "sound";
const MUSIC_VOLUME = 0.35;
const SFX_VOLUME = 0.8;
const DRAWING_VOLUME = 0.5;
const DRAWING_IDLE_MS = 140; // the scratching stops when the pen stops moving
const FADE_S = 0.12;
const FILL_FADE_S = 0.1;
const FILL_URLS = [fill1Url, fill2Url, fill3Url];

type Listener = () => void;

let enabled = localStorage.getItem(STORAGE_KEY) === "on";
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

let lastFill = -1;

export const sound = {
  isEnabled: () => enabled,

  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Call from a user gesture (the toggle). */
  setEnabled(on: boolean) {
    enabled = on;
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    listeners.forEach((l) => l());

    if (on) {
      getContext().resume();
      startMusic();
      FILL_URLS.forEach((url) => loadBuffer(url).catch(() => {}));
      loadBuffer(drawingUrl).catch(() => {});
    } else {
      stopMusic();
      stopDrawingNow();
    }
  },

  /** Retry anything the browser blocked before the first gesture (e.g. sound was left on last visit). */
  unlock() {
    if (!enabled) return;
    getContext().resume();
    if (music?.paused !== false) startMusic();
  },

  /** Call on every pen movement while drawing; the loop fades out shortly after movement stops. */
  drawingActivity() {
    if (!enabled) return;
    if (!drawing && !drawingWanted) void startDrawingNow();
    clearTimeout(drawingIdleTimer);
    drawingIdleTimer = setTimeout(stopDrawingNow, DRAWING_IDLE_MS);
  },

  stopDrawing: stopDrawingNow,

  /** A random fill sound, never the same one twice in a row. Overlaps with anything already playing. */
  async playFill() {
    if (!enabled) return;
    let i = Math.floor(Math.random() * FILL_URLS.length);
    if (i === lastFill) i = (i + 1 + Math.floor(Math.random() * (FILL_URLS.length - 1))) % FILL_URLS.length;
    lastFill = i;

    const buffer = await loadBuffer(FILL_URLS[i]).catch(() => null);
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
    if (!enabled) return;
    if (hidden) stopMusic();
    else startMusic();
  },
};
