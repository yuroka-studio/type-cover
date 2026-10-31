// Small colour helpers (sRGB, 8-bit). Everything is plain arithmetic, so the output is deterministic.

/** @param {string} value "#rgb" or "#rrggbb" @returns {[number, number, number]} */
export function parseColor(value, what = "colour") {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) throw new Error(`${what} must be a hex colour like #5FD0C4, got "${value}"`);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}

export const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** Linear mix in sRGB space: t = 0 gives a, t = 1 gives b. */
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Rough perceptual lightness 0..1 (Rec. 709 weights on the gamma-encoded values). */
export const lightness = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

/**
 * Work out the full palette from the few colours the user gives.
 * Anything in `overrides` (rule, muted, guide) wins over the derived value.
 */
export function buildPalette({ background, ink, accent, overrides = {} }) {
  const bg = parseColor(background, "background");
  const light = lightness(bg) > 0.55;
  const fg = parseColor(ink ?? (light ? "#14141c" : "#f0ece8"), "ink");
  const pick = (name, fallback) => (overrides[name] ? parseColor(overrides[name], `colors.${name}`) : fallback);
  return {
    light,
    bg: toHex(bg),
    // the soft vignette: a hair lighter in the middle, darker at the edge
    bgCenter: toHex(mix(bg, light ? WHITE : WHITE, light ? 0.5 : 0.015)),
    bgEdge: toHex(mix(bg, BLACK, light ? 0.1 : 0.35)),
    ink: toHex(fg),
    accent: toHex(parseColor(accent, "accent")),
    rule: toHex(pick("rule", mix(bg, fg, 0.38))),
    muted: toHex(pick("muted", mix(bg, fg, 0.62))),
    guide: toHex(pick("guide", mix(bg, fg, 0.52))),
  };
}
