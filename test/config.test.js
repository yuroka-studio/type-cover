import assert from "node:assert/strict";
import test from "node:test";
import { buildPalette, lightness, parseColor } from "../src/color.js";
import { resolveConfig, resolveOutputs } from "../src/config.js";

test("defaults match the original cover", () => {
  const c = resolveConfig({ title: "X" });
  assert.deepEqual(c.error, [19, -12]);
  assert.equal(c.accent, "#5FD0C4");
  assert.equal(c.background, "#080810");
  assert.equal(c.grain, 0.07);
  assert.equal(c.template, "crosshair");
  assert.equal(c.title.lines[0], "X");
});

test("text is kept exactly as written unless uppercase is asked for, and then uses the language", () => {
  assert.deepEqual(resolveConfig({ title: "isimsiz" }).title.lines, ["isimsiz"]);
  assert.deepEqual(resolveConfig({ title: "isimsiz", uppercase: true, locale: "tr" }).title.lines, ["İSİMSİZ"]);
  assert.deepEqual(resolveConfig({ title: "isimsiz", uppercase: true, locale: "en" }).title.lines, ["ISIMSIZ"]);
  assert.equal(resolveConfig({ title: "x", artist: "kuzey", uppercase: true, locale: "tr" }).artist, "KUZEY");
  assert.throws(() => resolveConfig({ title: "x", locale: "not a tag!" }), /locale/);
});

test("bad settings are named, and typos are not silently ignored", () => {
  assert.throws(() => resolveConfig({ title: "X", acent: "#fff" }), /unknown option "acent"/);
  assert.throws(() => resolveConfig({ title: "X", grain: 2 }), /grain must be between 0 and 1/);
  assert.throws(() => resolveConfig({ title: "X", seed: 1.5 }), /seed must be a whole number/);
  assert.throws(() => resolveConfig({ title: "X", template: "spiral" }), /template must be one of/);
  assert.throws(() => resolveConfig({ title: "X", error: [1] }), /error must be two numbers/);
  assert.throws(() => resolveConfig({ title: "X", error: "a,b" }), /error x must be a number/);
  assert.throws(() => resolveConfig({ title: "X", titleLines: 3 }), /titleLines/);
  assert.throws(() => resolveConfig({ title: "X", titleWeight: 1000 }), /titleWeight/);
  assert.throws(() => resolveConfig({ title: "X", colors: { bogus: "#fff" } }), /unknown colors\.bogus/);
  assert.throws(() => resolveConfig({}), /title is required/);
  assert.deepEqual(resolveConfig({ title: "X", error: "19, -12" }).error, [19, -12]);
  assert.equal(resolveConfig({ title: "X", seed: "7", grain: "0.1" }).seed, 7);
});

test("output options are validated", () => {
  assert.deepEqual(resolveOutputs({}), { sizes: [3000, 1200, 600], formats: ["jpg", "webp", "avif"], svg: false, name: "cover" });
  assert.deepEqual(resolveOutputs({ sizes: "1200,600,1200", formats: "JPEG,webp" }).sizes, [1200, 600]);
  assert.deepEqual(resolveOutputs({ formats: "JPEG,webp" }).formats, ["jpg", "webp"]);
  assert.throws(() => resolveOutputs({ sizes: "10" }), /each size/);
  assert.throws(() => resolveOutputs({ formats: "gif" }), /unknown format/);
  assert.throws(() => resolveOutputs({ name: "../escape" }), /name may only/);
  assert.throws(() => resolveOutputs({ name: "a/b" }), /name may only/);
});

test("colours: hex only, a palette is derived from background, ink and accent", () => {
  assert.deepEqual(parseColor("#5fd0c4"), [95, 208, 196]);
  assert.deepEqual(parseColor("fff"), [255, 255, 255]);
  assert.throws(() => parseColor("teal"), /hex colour/);
  const dark = buildPalette({ background: "#080810", accent: "#5FD0C4" });
  assert.equal(dark.ink, "#f0ece8");
  assert.equal(dark.light, false);
  assert.ok(lightness(parseColor(dark.rule)) > lightness(parseColor(dark.bg)));
  const light = buildPalette({ background: "#f4f1ea", accent: "#c0392b" });
  assert.equal(light.light, true);
  assert.ok(lightness(parseColor(light.ink)) < 0.2, "dark text on a light background");
  const custom = buildPalette({ background: "#080810", accent: "#5FD0C4", overrides: { rule: "#6A6A88" } });
  assert.equal(custom.rule, "#6a6a88");
});
