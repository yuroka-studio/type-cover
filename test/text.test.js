import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfig } from "../src/config.js";
import { buildScene } from "../src/layout.js";
import { assertCovered, monoFont, outline, titleFont } from "../src/text.js";

const SAMPLES = ["KUSUR PAYI", "İSİMSİZ", "Fehlertoleranz", "ŞĞÇÉß ÖÜ àéîôûœ", "ığüşöç İĞÜŞÖÇ", "ÄÖÜäöüß", "ÀÂÇÉÈÊËÎÏÔÙÛÜŸŒæ", "ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ"];

test("the display font has a real glyph for Turkish, German, French and Polish letters (no .notdef)", () => {
  const font = titleFont();
  for (const text of SAMPLES) {
    const run = font.layout(text);
    assert.ok(run.glyphs.every((g) => g.id !== 0), `${text}: a character fell back to .notdef`);
    assert.doesNotThrow(() => assertCovered(font, text, "title", "Archivo"));
  }
});

test("the label font covers the same text", () => {
  const font = monoFont();
  for (const text of ["YRK-EP01", "±0.02", "İSİMSİZ ŞĞ", "Fehlertoleranz", "SIDE A / SIDE B", "Çağrı № 3", "ÀÉÎÖÜß"]) {
    assert.ok(font.layout(text).glyphs.every((g) => g.id !== 0), text);
  }
});

test("letters the fonts do not have are refused with a message, not drawn as boxes", () => {
  assert.throws(() => assertCovered(titleFont(), "Привет", "title", "Archivo"), /no glyph for "П" \(U\+041F\)/);
  assert.throws(() => buildScene(resolveConfig({ title: "日本語" })), /title line 1: .*no glyph/);
  assert.throws(() => buildScene(resolveConfig({ title: "OK", artist: "ΑΒΓ" })), /artist: .*no glyph/);
  assert.throws(() => buildScene(resolveConfig({ title: "OK", errorLabel: "±日" })), /errorLabel: .*no glyph/);
});

test("the variable font really is instanced (guard against silently getting the default weight)", () => {
  const k = (font) => font.layout("K").glyphs[0].path.toSVG();
  const heavyExpanded = k(titleFont({ weight: 800, width: 125 }));
  assert.notEqual(heavyExpanded, k(titleFont({ weight: 400, width: 100 })));
  assert.notEqual(heavyExpanded, k(titleFont({ weight: 600, width: 100 }))); // the font's own default instance
  assert.notEqual(heavyExpanded, k(titleFont({ weight: 800, width: 100 })));
  // heavier and wider really means more ink and more width
  const wide = outline(titleFont({ weight: 800, width: 125 }), "KUSUR");
  const narrow = outline(titleFont({ weight: 800, width: 62 }), "KUSUR");
  assert.ok(wide.bbox.x1 - wide.bbox.x0 > (narrow.bbox.x1 - narrow.bbox.x0) * 1.4);
});

test("outline boxes are real: İ rises above the cap height, Ş and Ç hang below the baseline, plain caps do neither", () => {
  const f = titleFont();
  const plain = outline(f, "KUSUR");
  const dotted = outline(f, "İ");
  const cedilla = outline(f, "ŞÇ");
  assert.ok(dotted.bbox.y1 > plain.capHeight + 0.15);
  assert.ok(cedilla.bbox.y0 < -0.15);
  assert.ok(plain.bbox.y0 > -0.03); // overshoot of round letters only
});

test("text is outlined from the bundled fonts only: the output does not depend on any system font", async () => {
  const { default: fs } = await import("node:fs");
  const { FONT_FILES } = await import("../src/text.js");
  for (const file of Object.values(FONT_FILES)) assert.ok(fs.existsSync(file), file);
  for (const dir of ["Archivo", "IBMPlexMono"]) {
    const licence = fs.readFileSync(new URL(`../fonts/${dir}/OFL.txt`, import.meta.url), "utf8");
    assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/i);
  }
});
