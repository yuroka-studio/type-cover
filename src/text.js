// Text -> vector outlines, using fontkit and the bundled fonts. No system fonts are ever read,
// so the glyph shapes are identical on every machine.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fonts");
export const FONT_FILES = {
  archivo: path.join(FONT_DIR, "Archivo", "Archivo-Variable.ttf"),
  mono: path.join(FONT_DIR, "IBMPlexMono", "IBMPlexMono-Medium.ttf"),
};

const cache = new Map();
const base = (key) => {
  if (!cache.has(key)) cache.set(key, fontkit.openSync(FONT_FILES[key]));
  return cache.get(key);
};

/**
 * The display font: Archivo, a variable font. Weight 100-900, width 62-125.
 * The defaults (800, 125) are the "Expanded ExtraBold" look of the original cover.
 */
export function titleFont({ weight = 800, width = 125 } = {}) {
  const key = `archivo:${weight}:${width}`;
  if (!cache.has(key)) cache.set(key, base("archivo").getVariation({ wght: weight, wdth: width }));
  return cache.get(key);
}

/** The label font: IBM Plex Mono Medium. */
export const monoFont = () => base("mono");

/** Throws a readable error for any character the font has no glyph for (it would silently draw ".notdef"). */
export function assertCovered(font, text, where, fontName) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (!font.hasGlyphForCodePoint(cp)) {
      throw new Error(
        `${where}: the bundled ${fontName} font has no glyph for "${ch}" (U+${cp.toString(16).toUpperCase().padStart(4, "0")}). ` +
          `Latin, Latin Extended (Turkish, German, French, Polish, ...) and Vietnamese are covered; Greek, Cyrillic, Arabic and CJK are not.`,
      );
    }
  }
}

/**
 * Outline `text` once, in em units (y up, origin at the pen start on the baseline).
 * @returns {{segments: (string|number)[][], advance: number, bbox: {x0:number,y0:number,x1:number,y1:number}, capHeight: number}}
 *   `advance` and `bbox` are in em; tracking is in em as well (added between glyphs, not after the last).
 */
export function outline(font, text, { tracking = 0 } = {}) {
  const run = font.layout(text);
  const upm = font.unitsPerEm;
  const segments = [];
  const pts = []; // for the bounding box
  let pen = 0;
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    const ox = (pen + pos.xOffset) / upm;
    const oy = pos.yOffset / upm;
    const X = (v) => ox + v / upm;
    const Y = (v) => oy + v / upm;
    let cur = null;
    for (const c of g.path.commands) {
      const a = c.args;
      if (c.command === "moveTo") {
        cur = [X(a[0]), Y(a[1])];
        segments.push(["M", ...cur]);
        pts.push(cur);
      } else if (c.command === "lineTo") {
        cur = [X(a[0]), Y(a[1])];
        segments.push(["L", ...cur]);
        pts.push(cur);
      } else if (c.command === "quadraticCurveTo") {
        const q = [X(a[0]), Y(a[1]), X(a[2]), Y(a[3])];
        segments.push(["Q", ...q]);
        pts.push([q[2], q[3]]);
        for (const axis of [0, 1]) {
          // exact extremum of a quadratic: t = (p0 - p1) / (p0 - 2 p1 + p2)
          const p0 = cur[axis], p1 = q[axis], p2 = q[2 + axis];
          const den = p0 - 2 * p1 + p2;
          const t = den === 0 ? -1 : (p0 - p1) / den;
          if (t > 0 && t < 1) {
            const u = 1 - t;
            const e = [0, 0];
            for (const k of [0, 1]) e[k] = u * u * cur[k] + 2 * u * t * q[k] + t * t * q[2 + k];
            pts.push(e);
          }
        }
        cur = [q[2], q[3]];
      } else if (c.command === "bezierCurveTo") {
        const b = [X(a[0]), Y(a[1]), X(a[2]), Y(a[3]), X(a[4]), Y(a[5])];
        segments.push(["C", ...b]);
        for (let s = 1; s <= 16; s++) {
          const t = s / 16, u = 1 - t;
          pts.push([0, 1].map((k) => u ** 3 * cur[k] + 3 * u * u * t * b[k] + 3 * u * t * t * b[2 + k] + t ** 3 * b[4 + k]));
        }
        cur = [b[4], b[5]];
      } else if (c.command === "closePath") {
        segments.push(["Z"]);
      }
    }
    pen += pos.xAdvance + (i < run.glyphs.length - 1 ? tracking * upm : 0);
  });
  if (pts.length === 0) throw new Error(`nothing to draw for "${text}"`);
  // a loop, not Math.min(...xs): spreading millions of points overflows the call stack on very long text
  const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    if (x < bbox.x0) bbox.x0 = x;
    if (x > bbox.x1) bbox.x1 = x;
    if (y < bbox.y0) bbox.y0 = y;
    if (y > bbox.y1) bbox.y1 = y;
  }
  return {
    segments,
    advance: pen / upm,
    bbox,
    capHeight: (font["OS/2"]?.capHeight ?? 700) / upm,
  };
}

const r2 = (n) => Number(n.toFixed(2));

/**
 * Put an outline on the artboard.
 * @param {ReturnType<typeof outline>} o
 * @param {{size:number, y:number, x:number, anchor?: "start"|"middle"|"end"}} p
 *   x is the left ink edge, the ink centre or the right ink edge, depending on `anchor`; y is the baseline.
 *   Anchoring uses the ink box, so what you see is what is centred.
 * @returns {{d: string, box: {x0:number,y0:number,x1:number,y1:number}, width: number}} box is in artboard units, y down
 */
export function place(o, { size, x, y, anchor = "start" }) {
  const inkW = (o.bbox.x1 - o.bbox.x0) * size;
  const left = anchor === "middle" ? x - inkW / 2 : anchor === "end" ? x - inkW : x;
  const dx = left - o.bbox.x0 * size;
  const X = (v) => r2(dx + v * size);
  const Y = (v) => r2(y - v * size);
  const d = o.segments
    .map(([c, ...a]) => (c === "Z" ? "Z" : c + a.map((v, i) => (i % 2 === 0 ? X(v) : Y(v))).join(" ")))
    .join("");
  return {
    d,
    width: inkW,
    box: { x0: left, x1: left + inkW, y0: y - o.bbox.y1 * size, y1: y - o.bbox.y0 * size },
  };
}
