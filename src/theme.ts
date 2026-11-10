/**
 * Two-tone palette, as CSS variables so the theme can switch at runtime (see index.css and ThemeToggle).
 * Both are plain strings, so Dragology sees identical values across states and never tries to blend them.
 */
export const INK = "var(--ink)";
export const PAPER = "var(--paper)";

export type Theme = "dark" | "light";
