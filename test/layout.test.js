import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfig } from "../src/config.js";
import { buildScene, W, MID } from "../src/layout.js";
import { assertClean } from "./helpers.js";

const scene = (over) => buildScene(resolveConfig({ title: "KUSUR PAYI", ...over }));
const full = { artist: "YUROKA", catalog: "YRK-EP01", year: "2026", footerLeft: "SIDE A / SIDE B" };

const titles = [
  "KUSUR PAYI", "İSİMSİZ", "Fehlertoleranz", "ŞĞÇÉß ÖÜ", "ÇİĞ ÖĞÜŞ İĞNE", "SIDE", "A", "Ağır Çekim", "Ürün Şöleni Çağrısı", "ÅNGSTRÖM",
  "A VERY LONG TITLE WITH MANY WORDS IN IT", "ÇOK UZUN BİR ŞARKI ADI BURADA",
    "WWWWWWWWWW", "iiiiiiiiii jjjjjjjjjj", "ŞŞŞŞŞ|ÇÇÇÇÇ", "gg|yy",
];
const labelSets = [
  full,
  { artist: "ÖZGÜR ÇINAR", catalog: "ŞĞ-İ001", year: "2026", footerLeft: "A YÜZÜ / B YÜZÜ" },
  { artist: "SOME LONG ARTIST NAME", catalog: "CATALOG NUMBER 0001", year: "2026", footerLeft: "SIDE A / SIDE B / SOME MORE" },
  { artist: "ÅSA ÖSTERGÅRD", catalog: "ÅÖ-01", year: "ÇĞ", footerLeft: "gypsy, jazz; (quoted)" },
  {},
];
const errors = [[19, -12], [0, 0], [80, -60], [-300, 300], [-12, 40], [-45, -45], [200, 5]];

for (const template of ["crosshair", "grid"]) {
  test(`${template}: text never collides with corner marks, other text or the centre line (${titles.length} titles x ${labelSets.length} label sets x ${errors.length} offsets)`, () => {
    let n = 0;
    for (const title of titles) {
      for (const labels of labelSets) {
        for (const error of template === "grid" ? [[19, -12]] : errors) {
          const s = scene({ template, title, error, ...labels });
          assertClean(s, `${template} / ${JSON.stringify(title)} / ${labels.artist ?? "-"} / ${error}`);
          n++;
        }
      }
    }
    assert.ok(n >= 80);
  });
}

test("diacritics move the line apart instead of colliding: cedilla over the scale, dots under the label row", () => {
  const plain = scene({ title: "SEKER|CAGRI", ...full });
  const turkish = scene({ title: "ŞEKER|ÇAĞRI", ...full });
  // same size, but the Ş cedilla pushes line 1 up and the Ğ breve pushes line 2 down
  assert.equal(plain.plan.size, turkish.plan.size);
  assert.ok(turkish.boxes.title[0].y1 <= MID - 20, "cedilla stays above the scale");
  assert.ok(turkish.boxes.title[0].y0 < plain.boxes.title[0].y0 - 20, "line 1 moved up by about the cedilla depth");
  assert.ok(turkish.boxes.title[1].y0 >= MID + 20, "breve stays below the scale");
  assert.ok(turkish.boxes.title[1].y1 > plain.boxes.title[1].y1 + 20, "line 2 moved down");
  // İ has a dot above the cap height
  const dotted = scene({ title: "İSİMSİZ" });
  const dotless = scene({ title: "ISIMSIZ" });
  assert.ok(dotted.boxes.title[0].y0 < dotless.boxes.title[0].y0 - 20, "the dots rise above the capitals");
});

test("labels with diacritics push their row away from the bracket instead of crossing it", () => {
  const plain = scene({ ...full, artist: "OZGUR", catalog: "SG-I001" });
  const accented = scene({ ...full, artist: "ÖZGÜR ÅSA", catalog: "ŞĞ-İ001", footerLeft: "gypsy; jazz" });
  const top = (s, id) => s.boxes.labels.find((l) => l.id === id).y0;
  assert.ok(top(accented, "artist") >= 66 && top(accented, "catalog") >= 66);
  assert.ok(accented.boxes.labels.find((l) => l.id === "footerLeft").y1 <= W - 56 - 10);
  assert.ok(top(plain, "artist") <= 80); // ordinary text keeps the original position
});

test("an error offset that would push the cross into the label rows is limited, with a warning", () => {
  const s = scene({ ...full, error: [300, -300] });
  assert.ok(s.warnings.some((w) => /error offset .* limited/.test(w)), s.warnings.join("\n"));
  assert.ok(Math.abs(s.cross.error[0]) < 300 && Math.abs(s.cross.error[1]) < 300);
  assertClean(s);
  assert.deepEqual(scene({ ...full, error: [19, -12] }).warnings, []);
});

test("the error label defaults to the length of the offset, and a given label wins", () => {
  const labelOf = (s) => s.cross.label;
  assert.ok(labelOf(scene({ error: [19, -12] })).d.length > 20);
  const long = scene({ error: [19, -12], errorLabel: "±0.02 mm TOLERANCE" });
  assert.ok(long.cross.label.box.x1 <= W - 90 || long.cross.label.side === "left");
  assert.equal(scene({ error: [19, -12], errorLabel: "" }).cross.label, null);
  assertClean(long);
});

test("the crosshair is off-centre by exactly the error, and 0,0 puts it on the dashed circle", () => {
  assert.deepEqual(scene({ error: [19, -12] }).cross.T, { x: MID + 19, y: MID - 12 });
  assert.deepEqual(scene({ error: [0, 0] }).cross.T, { x: MID, y: MID });
});

test("the grid template has no crosshair", () => {
  const s = scene({ template: "grid", ...full });
  assert.equal(s.cross, null);
});

test("auto-fit: the largest size that fits, never above 178, never wider than 840 units", () => {
  const s = scene({ title: "KUSUR PAYI" });
  assert.equal(s.plan.size, 178); // the size of the original cover
  assert.deepEqual(s.plan.lines, ["KUSUR", "PAYI"]);
  for (const title of ["SONRA", "A", "KUSUR PAYI", "İSİMSİZ", "Fehlertoleranz", "ÇOK UZUN BİR ŞARKI ADI BURADA", "A VERY LONG TITLE WITH MANY WORDS IN IT"]) {
    const t = scene({ title });
    assert.ok(t.plan.size <= 178 + 1e-9, title);
    for (const b of t.boxes.title) assert.ok(b.x1 - b.x0 <= 840 + 1e-6, `${title}: ${b.x1 - b.x0}`);
    const widest = Math.max(...t.boxes.title.map((b) => b.x1 - b.x0));
    if (t.plan.size < 178) assert.ok(widest > 840 - 0.01, `${title} is smaller than it needs to be (${widest})`);
  }
});

test("auto-fit: longer titles get smaller type, and 1 or 2 lines are picked for the larger size", () => {
  const size = (title, extra) => scene({ title, ...extra }).plan.size;
  assert.ok(size("KUSUR PAYI KUSUR PAYI") < size("KUSUR PAYI"));
  assert.ok(size("KUSUR PAYI KUSUR PAYI KUSUR PAYI") < size("KUSUR PAYI KUSUR PAYI"));
  assert.equal(scene({ title: "SONRA" }).plan.lines.length, 1); // short: stays on one line
  assert.equal(scene({ title: "A VERY LONG TITLE WITH MANY WORDS IN IT" }).plan.lines.length, 2); // long: splits at the best word
  assert.deepEqual(scene({ title: "KUSUR PAYI", titleLines: 1 }).plan.lines, ["KUSUR PAYI"]);
  assert.ok(size("KUSUR PAYI", { titleLines: 1 }) < 120);
  assert.deepEqual(scene({ title: "ONE TWO THREE FOUR" , titleLines: 2 }).plan.lines.length, 2);
  // "|" or a newline forces the break
  assert.deepEqual(scene({ title: "A B|C D" }).plan.lines, ["A B", "C D"]);
  assert.deepEqual(scene({ title: ["A B", "C D"] }).plan.lines, ["A B", "C D"]);
  assert.deepEqual(scene({ title: "A B\nC D" }).plan.lines, ["A B", "C D"]);
});

test("auto-fit: clear errors for titles that cannot work", () => {
  assert.throws(() => scene({ title: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" }), /too long to fit legibly/);
  assert.ok(scene({ title: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", titleWidth: 62 }).plan.size >= 36); // a narrower cut makes room
  assert.throws(() => scene({ title: "A|B|C" }), /at most 2 lines/);
  assert.throws(() => scene({ title: "SINGLE", titleLines: 2 }), /single word/);
  assert.throws(() => scene({ title: "" }), /title is required/);
  assert.throws(() => scene({ title: "OK", artist: "A NAME THAT IS FAR TOO LONG TO EVER FIT IN A CORNER LABEL" }), /artist is too long/);
});

test("labels shrink to fit their half of the row and say so", () => {
  const s = scene({ ...full, artist: "SOME LONG ARTIST NAME" });
  assert.ok(s.warnings.some((w) => /artist was too wide/.test(w)));
  const a = s.boxes.labels.find((l) => l.id === "artist");
  assert.ok(a.x1 <= 480);
  assert.deepEqual(scene(full).warnings, []);
});
