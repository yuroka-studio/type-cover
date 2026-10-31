// The drawing, as data: every piece of text is outlined and placed, then measured, so the layout
// reacts to what is actually written (diacritics, descenders, long names) and the same boxes can be
// checked in tests. All numbers are in artboard units: a 1000 x 1000 square, scaled to any pixel size.
import { buildPalette } from "./color.js";
import { assertCovered, monoFont, outline, place, titleFont } from "./text.js";

export const W = 1000;
export const MID = 500;
export const M = 56; // margin to the corner marks
export const BRACKET = 30; // corner bracket arm length
export const INSET = 22; // label inset from the brackets
export const LABEL_LEFT = M + INSET; // 78
export const LABEL_RIGHT = W - M - INSET; // 922
export const CENTER_GAP = 24; // labels keep this far from the vertical centre line
export const LABEL_MAX_WIDTH = MID - CENTER_GAP - LABEL_LEFT; // 398

const TITLE_MAX_WIDTH = 840;
const TITLE_MAX_SIZE = 178;
const TITLE_MIN_SIZE = 36;
const TITLE_TRACKING = 0.01;
const AXIS_CLEAR = 32; // between the centre line and the nearest title ink (crosshair)
const GRID_CLEAR = 26;
const R = 300; // registration circle radius
const REACH_MAX = R * 1.2;
const REACH_MIN = R * 1.06;
const FRAME_X = 90; // arms and labels stay inside x in [90, 910]
const FRAME_Y_MIN = 120;
const BRACKET_CLEAR = 12; // text ink stays this far from the bracket lines

const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
export const overlaps = (a, b, pad = 0) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** The eight arms of the four corner brackets, as thin boxes (a bracket is two lines, its corner square is empty). */
export const cornerBoxes = () => {
  const t = 1; // half the hairline, rounded up
  const arms = [];
  for (const [cx, cy, sx, sy] of [[M, M, 1, 1], [W - M, M, -1, 1], [M, W - M, 1, -1], [W - M, W - M, -1, -1]]) {
    const hx = cx + sx * BRACKET;
    const vy = cy + sy * BRACKET;
    arms.push(rect(Math.min(cx, hx), cy - t, Math.max(cx, hx), cy + t), rect(cx - t, Math.min(cy, vy), cx + t, Math.max(cy, vy)));
  }
  return arms;
};

// ------------------------------------------------------------------ title
function inkWidthEm(o) {
  return o.bbox.x1 - o.bbox.x0;
}

/** Size at which the widest of `outlines` just fits the title width, capped. */
const fitSize = (outlines) => Math.min(TITLE_MAX_SIZE, TITLE_MAX_WIDTH / Math.max(...outlines.map(inkWidthEm)));

/** Choose 1 or 2 lines for the title, and the largest size at which they fit. */
function planTitle(cfg, font) {
  const measure = (s) => outline(font, s, { tracking: TITLE_TRACKING });
  const make = (lines) => {
    const outlines = lines.map(measure);
    return { lines, outlines, size: fitSize(outlines) };
  };
  let plan;
  if (cfg.title.explicit) {
    plan = make(cfg.title.lines);
  } else {
    const text = cfg.title.lines[0];
    const words = text.split(/\s+/);
    const one = make([text]);
    if (cfg.titleLines === 1 || words.length < 2) {
      if (cfg.titleLines === 2) throw new Error('titleLines is 2 but the title is a single word: put a space or "|" where the line should break');
      plan = one;
    } else {
      // best two-line split: the one that allows the largest type
      let best = null;
      for (let k = 1; k < words.length; k++) {
        const cand = make([words.slice(0, k).join(" "), words.slice(k).join(" ")]);
        if (!best || cand.size > best.size) best = cand;
      }
      plan = cfg.titleLines === 2 || best.size > one.size * 1.2 ? best : one;
    }
  }
  if (plan.size < TITLE_MIN_SIZE) {
    throw new Error(
      `the title is too long to fit legibly (it would need type smaller than ${TITLE_MIN_SIZE} units). ` +
        `Shorten it, split it into two lines with "|", or lower titleWidth.`,
    );
  }
  return plan;
}

/** Place the title lines. Returns placed lines (with boxes) and the y of the lowest ink. */
function layoutTitle(plan, clear, centered) {
  const size = plan.size;
  const cap = plan.outlines[0].capHeight;
  const allow = 0.02 * size; // round-letter overshoot does not count as a descender or a diacritic
  const below = (o) => Math.max(0, -o.bbox.y0 * size - allow); // ink under the baseline (cedilla, comma ...)
  const above = (o) => Math.max(0, (o.bbox.y1 - cap) * size - allow); // ink over the cap height (dots, accents ...)
  const lines = [];
  if (plan.lines.length === 2) {
    const [o1, o2] = plan.outlines;
    const y1 = MID - clear - below(o1);
    const y2 = MID + clear + above(o2) + cap * size;
    lines.push(place(o1, { size, x: MID, y: y1, anchor: "middle" }), place(o2, { size, x: MID, y: y2, anchor: "middle" }));
  } else {
    // one line: on the crosshair template it sits on the measuring scale, like the first line of a
    // two-line title; on the grid template (no scale) its cap height is centred on the cover
    const [o] = plan.outlines;
    const y = centered ? MID + (cap * size) / 2 : MID - clear - below(o);
    lines.push(place(o, { size, x: MID, y, anchor: "middle" }));
  }
  return lines;
}

// ------------------------------------------------------------------ corner labels
/** An outlined label that shrinks (down to 55%) to fit its half of the row. */
function fitLabel(font, fontName, label, str, nominal, tracking) {
  assertCovered(font, str, label, fontName);
  const o = outline(font, str, { tracking });
  const size = Math.min(nominal, LABEL_MAX_WIDTH / inkWidthEm(o));
  if (size < nominal * 0.55) {
    const shown = [...str].length > 40 ? `${[...str].slice(0, 40).join("")}...` : str;
    throw new Error(`${label} is too long for the corner label (about ${Math.floor((str.length * LABEL_MAX_WIDTH) / (inkWidthEm(o) * nominal * 0.55))} characters at most): "${shown}"`);
  }
  return { o, size, shrunk: size < nominal };
}

// ------------------------------------------------------------------ the scene
/**
 * @param {ReturnType<import("./config.js").resolveConfig>} cfg
 */
export function buildScene(cfg) {
  const warnings = [];
  const palette = buildPalette({ background: cfg.background, ink: cfg.ink, accent: cfg.accent, overrides: cfg.colors });
  const display = titleFont({ weight: cfg.titleWeight, width: cfg.titleWidth });
  const mono = monoFont();
  const wordmarkFont = titleFont({ weight: 800, width: 125 });

  // --- title
  for (const [i, line] of cfg.title.lines.entries()) assertCovered(display, line, `title line ${i + 1}`, "Archivo");
  const plan = planTitle(cfg, display);
  const clear = cfg.template === "crosshair" ? AXIS_CLEAR : GRID_CLEAR;
  const titleLines = layoutTitle(plan, clear, cfg.template === "grid");

  // --- corner labels: artist (top left), catalog (top right), footer text (bottom left), year (bottom right)
  const specs = [
    { id: "artist", str: cfg.artist, font: wordmarkFont, fontName: "Archivo", nominal: 30, tracking: 0.18, side: "left", row: "top" },
    { id: "catalog", str: cfg.catalog, font: mono, fontName: "IBM Plex Mono", nominal: 17, tracking: 0.14, side: "right", row: "top" },
    { id: "footerLeft", str: cfg.footerLeft, font: mono, fontName: "IBM Plex Mono", nominal: 17, tracking: 0.14, side: "left", row: "bottom" },
    { id: "year", str: cfg.year, font: mono, fontName: "IBM Plex Mono", nominal: 17, tracking: 0.14, side: "right", row: "bottom" },
  ]
    .filter((s) => s.str)
    .map((s) => ({ ...s, ...fitLabel(s.font, s.fontName, s.id, s.str, s.nominal, s.tracking) }));
  for (const s of specs) if (s.shrunk) warnings.push(`${s.id} was too wide for its corner and was set smaller (${s.size.toFixed(1)} instead of ${s.nominal})`);

  // rows keep ink clear of the bracket lines even when a name carries diacritics or descenders
  const capOf = (s) => s.o.capHeight;
  const topSpecs = specs.filter((s) => s.row === "top");
  const bottomSpecs = specs.filter((s) => s.row === "bottom");
  const rowTop = Math.max(LABEL_LEFT, ...topSpecs.map((s) => M + BRACKET_CLEAR + (s.o.bbox.y1 - capOf(s)) * s.size));
  const rowBase = Math.min(LABEL_RIGHT, ...bottomSpecs.map((s) => W - M - BRACKET_CLEAR + s.o.bbox.y0 * s.size));
  const labels = specs.map((s) => {
    const y = s.row === "top" ? rowTop + capOf(s) * s.size : rowBase;
    const p = place(s.o, s.side === "left" ? { size: s.size, x: LABEL_LEFT, y } : { size: s.size, x: LABEL_RIGHT, y, anchor: "end" });
    return { id: s.id, side: s.side, row: s.row, ...p };
  });
  const topBottom = Math.max(0, ...labels.filter((l) => l.row === "top").map((l) => l.box.y1));
  const bottomTop = Math.min(W, ...labels.filter((l) => l.row === "bottom").map((l) => l.box.y0));

  // --- the registration mark (crosshair template)
  let cross = null;
  if (cfg.template === "crosshair") {
    const topLimit = Math.max(FRAME_Y_MIN, topBottom + 18);
    const bottomLimit = Math.min(W - FRAME_Y_MIN, bottomTop - 18);
    const yFree = Math.min(MID - topLimit, bottomLimit - MID);
    const xFree = MID - FRAME_X;
    let [ex, ey] = cfg.error;
    const maxX = xFree - REACH_MIN;
    const maxY = yFree - REACH_MIN;
    const cx = Math.max(-maxX, Math.min(maxX, ex));
    const cy = Math.max(-maxY, Math.min(maxY, ey));
    if (cx !== ex || cy !== ey) {
      warnings.push(`error offset (${ex}, ${ey}) is too large for this layout and was limited to (${cx}, ${cy}) so the cross stays clear of the corner labels`);
      ex = cx;
      ey = cy;
    }
    const T = { x: MID + ex, y: MID + ey };
    const reach = Math.max(REACH_MIN, Math.min(REACH_MAX, xFree - Math.abs(ex), yFree - Math.abs(ey)));
    const labelText = cfg.errorLabel ?? `±${(Math.hypot(ex, ey) / 1000).toFixed(2)}`;
    let label = null;
    if (labelText) {
      assertCovered(mono, labelText, "errorLabel", "IBM Plex Mono");
      const o = outline(mono, labelText, { tracking: 0.06 });
      const size = 16;
      const top = T.y - reach;
      const y = top + o.bbox.y1 * size; // ink top sits on the end of the arm
      let p = place(o, { size, x: T.x + 12, y });
      let side = "right";
      if (p.box.x1 > W - FRAME_X) {
        p = place(o, { size, x: T.x - 12, y, anchor: "end" });
        side = "left";
      }
      label = { ...p, side };
    }
    cross = { T, R, reach, label, error: [ex, ey] };
  }

  // --- everything with a box, for collision checks
  const boxes = {
    title: titleLines.map((l) => l.box),
    labels: labels.map((l) => ({ id: l.id, ...l.box })),
    crossLabel: cross?.label?.box ?? null,
    corners: cornerBoxes(),
  };
  const titleBottom = Math.max(...titleLines.map((l) => l.box.y1));

  return { cfg, palette, plan: { lines: plan.lines, size: plan.size }, titleLines, labels, cross, boxes, titleBottom, warnings };
}
