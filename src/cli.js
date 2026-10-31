import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { writeCover } from "./render.js";

const USAGE = `type-cover: deterministic typographic cover art, drawn in code

Usage
  type-cover --config cover.json [options]
  type-cover --title "KUSUR PAYI" --artist YUROKA --out out [options]

Text
  --title <text>          1 or 2 lines, auto-fitted. Use "|" to force the line break
  --artist <text>         top left
  --catalog <text>        top right, e.g. YRK-EP01
  --year <text>           bottom right
  --footer-left <text>    bottom left, e.g. "SIDE A / SIDE B"
  --uppercase             upper-case all text (language aware, see --locale)
  --locale <tag>          language for --uppercase, e.g. tr so that i becomes İ (default en)

Look
  --template <name>       crosshair (default) or grid
  --accent <hex>          accent colour (default #5FD0C4)
  --background <hex>      background colour (default #080810)
  --ink <hex>             text colour (default: chosen from the background)
  --grain <0-1>           grain amount (default 0.07; 0 turns it off)
  --seed <int>            grain seed (default 1)
  --error <x,y>           how far off-centre the crosshair is, in artboard units of 1000 (default 19,-12)
  --error-label <text>    label at the end of the cross (default derived from --error, e.g. ±0.02)
  --title-lines <n>       auto (default), 1 or 2
  --title-weight <100-900>  Archivo weight (default 800)
  --title-width <62-125>    Archivo width (default 125)

Output
  --out <dir>             output folder (default ./out)
  --name <base>           file name base (default cover)
  --sizes <list>          comma separated pixel sizes (default 3000,1200,600). 2000 and up: JPG only
  --formats <list>        formats for the smaller sizes: jpg,webp,avif (default all three)
  --svg                   also write <name>.svg, the vector master (no grain)

  --config <file.json>    read any of the options above from a JSON file; flags win over the file
  -h, --help              show this help
  -v, --version           show the version

Everything runs locally and offline. The same settings always give the same bytes.
`;

const FLAGS = {
  title: "title",
  artist: "artist",
  catalog: "catalog",
  year: "year",
  "footer-left": "footerLeft",
  template: "template",
  accent: "accent",
  background: "background",
  ink: "ink",
  grain: "grain",
  seed: "seed",
  error: "error",
  "error-label": "errorLabel",
  "title-lines": "titleLines",
  "title-weight": "titleWeight",
  "title-width": "titleWidth",
  locale: "locale",
  name: "name",
  sizes: "sizes",
  formats: "formats",
};

/** Read a JSON config. Keys starting with "$" or "_" (a $schema, notes) are ignored. */
export function readConfigFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`cannot read config ${path.basename(file)}: ${err.code === "ENOENT" ? "no such file" : err.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config ${path.basename(file)} is not valid JSON: ${err.message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`config ${path.basename(file)} must be a JSON object`);
  return Object.fromEntries(Object.entries(data).filter(([k]) => !/^[$_]/.test(k)));
}

/**
 * @param {string[]} argv
 * @param {{stdout?: {write(s: string): unknown}, stderr?: {write(s: string): unknown}}} [io]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const usageError = (msg) => {
    stderr.write(`type-cover: ${msg}\nTry --help.\n`);
    return 2;
  };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ...Object.fromEntries(Object.keys(FLAGS).map((f) => [f, { type: "string" }])),
        config: { type: "string" },
        out: { type: "string" },
        svg: { type: "boolean" },
        uppercase: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    return usageError(err.message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    stdout.write(`${JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version}\n`);
    return 0;
  }
  if (positionals.length > 0) return usageError(`unexpected argument "${positionals[0]}" (options start with --)`);

  try {
    const fromFile = values.config ? readConfigFile(values.config) : {};
    const fromFlags = {};
    for (const [flag, key] of Object.entries(FLAGS)) if (values[flag] !== undefined) fromFlags[key] = values[flag];
    if (values.svg) fromFlags.svg = true;
    if (values.uppercase) fromFlags.uppercase = true;
    const settings = { ...fromFile, ...fromFlags };
    if (settings.title === undefined) return usageError("a title is required: give --title or a config file with a title");
    const dir = path.resolve(values.out ?? "out");
    const { written, warnings } = await writeCover(settings, dir);
    for (const w of warnings) stderr.write(`type-cover: warning: ${w}\n`);
    for (const { file, bytes } of written) {
      const rel = path.relative(process.cwd(), file);
      stdout.write(`${rel.startsWith("..") || path.isAbsolute(rel) ? file : rel}  ${(bytes / 1024).toFixed(0)} KB\n`);
    }
    return 0;
  } catch (err) {
    stderr.write(`type-cover: ${err.message}\n`);
    return 1;
  }
}
