// Scene -> pixels with sharp. Everything that could vary between runs is pinned: no fonts are read from
// the system, the grain comes from a seeded generator, and no timestamps or metadata are written.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MASTER_MIN, resolveConfig, resolveOutputs } from "./config.js";
import { buildScene } from "./layout.js";
import { toSvg } from "./svg.js";

/** Small, fast, seeded PRNG (mulberry32): the same seed always gives the same sequence. */
export function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Film-like grain as an RGBA overlay. Each output size gets its own sequence, derived from the seed. */
async function grainLayer(px, seed, amount) {
  const big = px > 1500;
  // alpha 18 of 255 at full size and 14 below, for amount 0.07 (the look of the original cover)
  const alpha = Math.round(255 * amount * (big ? 1 : 14 / 18));
  if (alpha === 0) return null;
  const rnd = mulberry32((Math.imul(seed, 0x9e3779b1) ^ (px * 0x85ebca6b)) >>> 0);
  const buf = Buffer.alloc(px * px * 4);
  for (let i = 0; i < px * px; i++) {
    const v = Math.round(255 * (0.5 + (rnd() + rnd() + rnd() - 1.5) / 1.5));
    const g = v < 0 ? 0 : v > 255 ? 255 : v;
    buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = g;
    buf[i * 4 + 3] = alpha;
  }
  // 3000 px: soften to clumps like film; smaller sizes keep single-pixel grain
  const img = sharp(buf, { raw: { width: px, height: px, channels: 4 } });
  return (big ? img.blur(0.7) : img).raw().toBuffer();
}

/** Raw RGB pixels of the cover at `px` x `px`. */
export async function renderPixels(scene, px) {
  const base = await sharp(Buffer.from(toSvg(scene, px)), { density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (base.info.width !== px || base.info.height !== px) throw new Error(`rendered ${base.info.width}x${base.info.height}, expected ${px}x${px}`);
  const grain = await grainLayer(px, scene.cfg.seed, scene.cfg.grain);
  let img = sharp(base.data, { raw: base.info });
  if (grain) img = img.composite([{ input: grain, raw: { width: px, height: px, channels: 4 } }]);
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

const ENCODERS = {
  jpg: (img) => img.jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }),
  webp: (img) => img.webp({ quality: 80, smartSubsample: true }),
  avif: (img) => img.avif({ quality: 62, chromaSubsampling: "4:4:4" }),
};

export { MASTER_MIN };

/**
 * Render every requested file in memory.
 * @param {object} settings drawing settings plus optional `sizes`, `formats`, `svg`, `name`
 * @returns {Promise<{files: {name: string, size: number, format: string, data: Buffer}[], warnings: string[]}>}
 */
export async function renderCover(settings) {
  const cfg = resolveConfig(Object.fromEntries(Object.entries(settings).filter(([k]) => !["sizes", "formats", "svg", "name"].includes(k))));
  const out = resolveOutputs(settings);
  const scene = buildScene(cfg);
  const files = [];
  for (const size of [...out.sizes].sort((a, b) => b - a)) {
    const { data, info } = await renderPixels(scene, size);
    const formats = size >= MASTER_MIN ? ["jpg"] : out.formats;
    for (const format of formats) {
      const bytes = await ENCODERS[format](sharp(data, { raw: info })).toBuffer();
      files.push({ name: `${out.name}-${size}.${format}`, size, format, data: bytes });
    }
  }
  if (out.svg) files.push({ name: `${out.name}.svg`, size: 3000, format: "svg", data: Buffer.from(toSvg(scene, 3000)) });
  return { files, warnings: scene.warnings };
}

/** The SVG master as text (no grain: that is a raster effect). */
export function renderSvg(settings, px = 3000) {
  return toSvg(buildScene(resolveConfig(settings)), px);
}

/**
 * Write `data` to `file` through a temporary sibling and a rename. The rename replaces whatever is at `file`
 * (a symlink is replaced, never followed, so a planted link cannot redirect the write onto another file),
 * and a failed write cannot leave a truncated image behind.
 */
async function writeFileReplacing(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, data, { flag: "wx" });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Render and write into `dir`. Returns what was written. */
export async function writeCover(settings, dir) {
  const { files, warnings } = await renderCover(settings);
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  for (const f of files) {
    const file = path.join(dir, f.name);
    await writeFileReplacing(file, f.data);
    written.push({ file, bytes: f.data.length });
  }
  return { written, warnings };
}
