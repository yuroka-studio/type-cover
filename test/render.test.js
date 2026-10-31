import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { mulberry32, renderCover, renderSvg } from "../src/index.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOWCASE = JSON.parse(fs.readFileSync(path.join(root, "examples", "kusur-payi.json"), "utf8"));
delete SHOWCASE._comment;
const byName = (files) => Object.fromEntries(files.map((f) => [f.name, f.data]));

test("default outputs: a 3000 px JPG master plus 1200 and 600 in jpg, webp and avif", async () => {
  const { files, warnings } = await renderCover(SHOWCASE);
  assert.deepEqual(warnings, []);
  assert.deepEqual(files.map((f) => f.name).sort(), [
    "cover-1200.avif", "cover-1200.jpg", "cover-1200.webp", "cover-3000.jpg", "cover-600.avif", "cover-600.jpg", "cover-600.webp",
  ]);
  for (const f of files) {
    const meta = await sharp(f.data).metadata();
    assert.equal(meta.width, f.size, f.name);
    assert.equal(meta.height, f.size, f.name);
    assert.equal(meta.hasAlpha, false, f.name);
    assert.equal(meta.space, "srgb", f.name);
    assert.equal(meta.format, { jpg: "jpeg", webp: "webp", avif: "heif" }[f.format], f.name);
  }
  assert.ok(files.find((f) => f.name === "cover-3000.jpg").data.length < 3_000_000);
});

test("determinism: rendering twice in the same process gives byte-identical files, in every format", async () => {
  const settings = { ...SHOWCASE, svg: true };
  const a = byName((await renderCover(settings)).files);
  const b = byName((await renderCover(settings)).files);
  assert.deepEqual(Object.keys(a), Object.keys(b));
  assert.ok("cover.svg" in a && "cover-3000.jpg" in a && "cover-1200.avif" in a && "cover-600.webp" in a);
  for (const name of Object.keys(a)) assert.ok(a[name].equals(b[name]), `${name} differs between two runs`);
});

test("determinism: separate processes agree, and key order in the config does not matter", () => {
  const runs = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), "tc-det-")));
  try {
    const cfg = path.join(runs[0], "c.json");
    fs.writeFileSync(cfg, JSON.stringify(Object.fromEntries(Object.entries(SHOWCASE).reverse())));
    const [a, b] = runs.map((dir, i) => {
      const r = spawnSync(process.execPath, [path.join(root, "bin", "type-cover.js"), "--config", i === 0 ? cfg : path.join(root, "examples", "kusur-payi.json"), "--sizes", "600", "--out", path.join(dir, "o")], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return dir;
    });
    for (const f of fs.readdirSync(path.join(a, "o"))) {
      assert.ok(fs.readFileSync(path.join(a, "o", f)).equals(fs.readFileSync(path.join(b, "o", f))), `${f} differs between processes`);
    }
  } finally {
    for (const d of runs) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("the seed and the grain amount change the pixels, and nothing else does", async () => {
  const one = async (extra) => (await renderCover({ ...SHOWCASE, sizes: [600], formats: ["jpg"], ...extra })).files[0].data;
  const base = await one({});
  assert.ok((await one({})).equals(base));
  assert.ok(!(await one({ seed: 2 })).equals(base), "another seed gives other grain");
  assert.ok((await one({ seed: 1 })).equals(base));
  assert.ok(!(await one({ grain: 0 })).equals(base));
  assert.ok(!(await one({ grain: 0.2 })).equals(base));
  assert.ok((await one({ grain: 0 })).equals(await one({ grain: 0, seed: 99 })), "no grain means the seed has no effect");
});

test("the seeded generator is stable (values are part of the format promise)", () => {
  const r = mulberry32(1);
  assert.deepEqual([r(), r(), r()].map((v) => Number(v.toFixed(6))), [0.627074, 0.002736, 0.527447]);
});

test("no timestamps or file metadata end up in the images or the SVG", async () => {
  const { files } = await renderCover({ ...SHOWCASE, svg: true, sizes: [600], formats: ["jpg", "webp", "avif"] });
  for (const f of files) {
    const meta = await sharp(f.data).metadata();
    assert.equal(meta.exif, undefined, f.name);
    assert.equal(meta.xmp, undefined, f.name);
    assert.equal(meta.icc, undefined, f.name);
    const text = f.data.toString("latin1");
    assert.ok(!/20\d\d[:\-]\d\d[:\-]\d\d/.test(text), `${f.name} contains a date`);
  }
});

test("the SVG master is self-contained vector: outlines, no fonts, no external references", () => {
  const svg = renderSvg(SHOWCASE);
  assert.match(svg, /^<svg [^>]*width="3000" height="3000" viewBox="0 0 1000 1000"/);
  assert.ok(!/<text|font-family|href=|url\(http|<image|<script/i.test(svg));
  assert.equal(svg, renderSvg(SHOWCASE));
  assert.ok(svg.includes("#5fd0c4"));
});

test("the picture is what the layout says: dark ground, light title, accent cross, quiet corners", async () => {
  const { files } = await renderCover({ ...SHOWCASE, sizes: [600], formats: ["jpg"] });
  const { data, info } = await sharp(files[0].data).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [0, 1, 2].map((c) => data[(Math.round(y * 0.6) * info.width + Math.round(x * 0.6)) * info.channels + c]);
  const mean = (cells) => cells.reduce((s, c) => s + (c[0] + c[1] + c[2]) / 3, 0) / cells.length;
  assert.ok(mean([px(30, 30), px(970, 30), px(30, 970), px(970, 970), px(300, 900)]) < 25, "dark ground");
  assert.ok(px(108, 400)[0] > 200, "a letter of the title (the stem of the K) is light");
  // accent: the vertical arm of the cross is at x = 519; look for the teal pixel around it, away from the title
  const accent = [];
  for (let dx = -3; dx <= 3; dx++) accent.push(px(519 + dx, 800));
  const best = accent.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  assert.ok(best[1] > 150 && best[0] < 140, `accent line colour was ${best}`);
});

test("every example config renders without warnings", async () => {
  for (const file of fs.readdirSync(path.join(root, "examples")).filter((f) => f.endsWith(".json"))) {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "examples", file), "utf8"));
    for (const k of Object.keys(cfg)) if (k.startsWith("_")) delete cfg[k];
    const { files, warnings } = await renderCover({ ...cfg, sizes: [600], formats: ["jpg"] });
    assert.deepEqual(warnings, [], file);
    assert.equal(files.length, 1, file);
  }
});

test("the three required strings render as titles", async () => {
  for (const title of ["KUSUR PAYI", "İSİMSİZ", "Fehlertoleranz"]) {
    const { files } = await renderCover({ ...SHOWCASE, title, sizes: [600], formats: ["jpg"] });
    assert.equal((await sharp(files[0].data).metadata()).width, 600);
  }
});
