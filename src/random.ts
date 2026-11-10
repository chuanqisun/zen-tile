/** Deterministic PRNG so generated art is stable across renders within a session. */
export const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const hashString = (str: string) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};

// Fresh per page load, so every session is unique; mixed with an id so each instance differs too.
export const SESSION_SEED = (Math.random() * 2 ** 32) >>> 0;

export const seededRandom = (id: string) => mulberry32(SESSION_SEED ^ hashString(id));
