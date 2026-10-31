import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { main, readConfigFile } from "../src/cli.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "type-cover.js");
const run = (args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tc-test-"));
const withTmp = async (fn) => {
  const dir = tmp();
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("--help and --version", () => {
  const h = run(["--help"]);
  assert.equal(h.status, 0);
  for (const flag of ["--config", "--title", "--artist", "--catalog", "--year", "--footer-left", "--accent", "--background", "--grain", "--seed", "--error", "--error-label", "--svg", "--sizes"]) {
    assert.ok(h.stdout.includes(flag), `help mentions ${flag}`);
  }
  assert.match(run(["--version"]).stdout, /^\d+\.\d+\.\d+/);
});

test("flags alone are enough: files, sizes and formats as asked", () =>
  withTmp(async (dir) => {
    const r = run(["--title", "İSİMSİZ", "--artist", "YUROKA", "--catalog", "YRK-EP02", "--year", "2026", "--footer-left", "SIDE A", "--accent", "#FF6B4A", "--background", "#101018", "--grain", "0.05", "--seed", "4", "--error", "10,-8", "--error-label", "±0.01", "--sizes", "600,300", "--formats", "jpg,webp", "--svg", "--name", "ep", "--out", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["ep-300.jpg", "ep-300.webp", "ep-600.jpg", "ep-600.webp", "ep.svg"]);
    assert.equal((await sharp(path.join(dir, "ep-300.jpg")).metadata()).width, 300);
    assert.match(fs.readFileSync(path.join(dir, "ep.svg"), "utf8"), /#ff6b4a/);
    assert.match(r.stdout, /ep-600\.jpg/);
  }));

test("a config file works, and flags win over it", () =>
  withTmp(async (dir) => {
    const cfg = path.join(dir, "c.json");
    fs.writeFileSync(cfg, JSON.stringify({ _note: "ignored", title: "FROM FILE", accent: "#112233", sizes: [300], formats: ["jpg"], svg: true }));
    const a = path.join(dir, "a");
    const b = path.join(dir, "b");
    assert.equal(run(["--config", cfg, "--out", a]).status, 0);
    assert.equal(run(["--config", cfg, "--accent", "#445566", "--out", b]).status, 0);
    assert.match(fs.readFileSync(path.join(a, "cover.svg"), "utf8"), /#112233/);
    assert.match(fs.readFileSync(path.join(b, "cover.svg"), "utf8"), /#445566/);
  }));

test("the showcase example renders from the command line, at the three sizes asked", () =>
  withTmp(async (dir) => {
    const r = run(["--config", path.join(root, "examples", "kusur-payi.json"), "--sizes", "1200,600", "--formats", "jpg", "--out", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["cover-1200.jpg", "cover-600.jpg"]);
  }));

test("mistakes give a clear message and the right exit code", () => {
  assert.equal(run([]).status, 2); // no title
  assert.match(run([]).stderr, /title is required/);
  assert.equal(run(["--nope"]).status, 2);
  assert.equal(run(["stray"]).status, 2);
  const badColour = run(["--title", "X", "--accent", "teal", "--sizes", "100"]);
  assert.equal(badColour.status, 1);
  assert.match(badColour.stderr, /accent must be a hex colour/);
  assert.match(run(["--title", "X", "--grain", "5"]).stderr, /grain must be between 0 and 1/);
  assert.match(run(["--title", "A|B|C"]).stderr, /at most 2 lines/);
  assert.match(run(["--title", "日本"]).stderr, /no glyph/);
  assert.match(run(["--config", "does-not-exist.json"]).stderr, /no such file/);
});

test("config files: typos, wrong types and bad JSON are reported by name", () =>
  withTmp(async (dir) => {
    const write = (name, text) => {
      const f = path.join(dir, name);
      fs.writeFileSync(f, text);
      return f;
    };
    assert.match(run(["--config", write("typo.json", '{"title":"X","acent":"#fff"}')]).stderr, /unknown option "acent"/);
    assert.match(run(["--config", write("bad.json", "{ nope")]).stderr, /bad\.json is not valid JSON/);
    assert.match(run(["--config", write("arr.json", "[]")]).stderr, /must be a JSON object/);
    assert.deepEqual(readConfigFile(write("ok.json", '{"$schema":"x","_c":"y","title":"T"}')), { title: "T" });
  }));

test("main() works in-process and warns without failing", async () => {
  const dir = tmp();
  let out = "";
  let err = "";
  try {
    const code = await main(["--title", "OK", "--artist", "SOME LONG ARTIST NAME", "--sizes", "300", "--formats", "jpg", "--out", dir], {
      stdout: { write: (s) => (out += s) },
      stderr: { write: (s) => (err += s) },
    });
    assert.equal(code, 0);
    assert.match(err, /warning: artist was too wide/);
    assert.match(out, /cover-300\.jpg/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("config files: string booleans and an empty formats list are errors, not silent no-ops", () =>
  withTmp(async (dir) => {
    const cfg = (name, obj) => {
      const f = path.join(dir, name);
      fs.writeFileSync(f, JSON.stringify(obj));
      return f;
    };
    const out = path.join(dir, "out");
    const svgNo = run(["--config", cfg("a.json", { title: "X", sizes: [100], formats: ["jpg"], svg: "no" }), "--out", out]);
    assert.equal(svgNo.status, 1);
    assert.match(svgNo.stderr, /svg must be true or false, got "no"/);
    const upperFalse = run(["--config", cfg("b.json", { title: "x", sizes: [100], formats: ["jpg"], uppercase: "false" }), "--out", out]);
    assert.equal(upperFalse.status, 1);
    assert.match(upperFalse.stderr, /uppercase must be true or false/);
    const noFormats = run(["--config", cfg("c.json", { title: "X", sizes: [600], formats: [] }), "--out", out]);
    assert.equal(noFormats.status, 1);
    assert.match(noFormats.stderr, /formats must list at least one/);
    assert.ok(!fs.existsSync(out), "nothing is written when the settings are refused");
    const longCatalog = run(["--title", "X", "--catalog", "C".repeat(50000), "--sizes", "100", "--out", out]);
    assert.equal(longCatalog.status, 1);
    assert.match(longCatalog.stderr, /^type-cover: catalog is too long: 50000 characters/);
  }));
