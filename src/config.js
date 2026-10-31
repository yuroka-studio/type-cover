// Turn user input (a parsed JSON config merged with command line flags) into one validated, fully
// defaulted settings object. Unknown keys are errors, so a typo never silently does nothing.

export const TEMPLATES = ["crosshair", "grid"];
export const OUTPUT_FORMATS = ["jpg", "webp", "avif"];

export const DEFAULTS = Object.freeze({
  template: "crosshair",
  title: undefined,
  artist: "",
  catalog: "",
  year: "",
  footerLeft: "",
  accent: "#5FD0C4",
  background: "#080810",
  ink: undefined,
  colors: {},
  grain: 0.07,
  seed: 1,
  error: [19, -12],
  errorLabel: undefined,
  titleLines: "auto",
  titleWeight: 800,
  titleWidth: 125,
  uppercase: false,
  locale: "en",
});

/** Keys that describe what to write rather than what to draw. */
export const OUTPUT_KEYS = ["sizes", "formats", "svg", "name"];

const num = (v, what) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${what} must be a number, got ${JSON.stringify(v)}`);
  return n;
};
const text = (v, what) => {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") throw new Error(`${what} must be text, got ${JSON.stringify(v)}`);
  return v.trim();
};

/** Split a title into lines. A string may use "|" or a newline as the break; an array is taken as is. */
function parseTitle(v) {
  if (v === undefined || v === null || v === "") throw new Error("title is required (1 or 2 lines)");
  let lines;
  let explicit;
  if (Array.isArray(v)) {
    lines = v.map((l) => text(l, "title line"));
    explicit = true;
  } else if (typeof v === "string") {
    lines = v.split(/\r?\n|\|/).map((l) => l.trim());
    explicit = lines.length > 1;
  } else {
    throw new Error("title must be text or a list of 1 or 2 lines");
  }
  lines = lines.filter((l) => l !== "");
  if (lines.length === 0) throw new Error("title is required (1 or 2 lines)");
  if (lines.length > 2) throw new Error(`the title can have at most 2 lines, got ${lines.length}`);
  return { lines, explicit };
}

/** Validate and complete the drawing settings. Throws Error with a message that names the field. */
export function resolveConfig(input = {}) {
  const known = new Set([...Object.keys(DEFAULTS), ...OUTPUT_KEYS]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new Error(`unknown option "${key}". Known options: ${[...known].sort().join(", ")}`);
  }
  const c = { ...DEFAULTS, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };

  if (!TEMPLATES.includes(c.template)) throw new Error(`template must be one of ${TEMPLATES.join(", ")}, got "${c.template}"`);

  const locale = text(c.locale, "locale") || "en";
  try {
    "a".toLocaleUpperCase(locale);
  } catch {
    throw new Error(`locale "${locale}" is not a valid language tag (try "en" or "tr")`);
  }
  const upper = (s) => (c.uppercase ? s.toLocaleUpperCase(locale) : s);

  const title = parseTitle(c.title);
  const grain = num(c.grain, "grain");
  if (grain < 0 || grain > 1) throw new Error(`grain must be between 0 and 1, got ${grain}`);
  const seed = num(c.seed, "seed");
  if (!Number.isInteger(seed)) throw new Error(`seed must be a whole number, got ${seed}`);

  let error = c.error;
  if (typeof error === "string") error = error.split(/[,\s]+/).filter(Boolean);
  if (!Array.isArray(error) || error.length !== 2) throw new Error(`error must be two numbers "x,y" (artboard units, 1000 = full cover), got ${JSON.stringify(c.error)}`);
  error = error.map((v, i) => num(v, `error ${i === 0 ? "x" : "y"}`));

  const titleLines = c.titleLines === "auto" || c.titleLines === undefined ? "auto" : num(c.titleLines, "titleLines");
  if (titleLines !== "auto" && titleLines !== 1 && titleLines !== 2) throw new Error(`titleLines must be "auto", 1 or 2, got ${JSON.stringify(c.titleLines)}`);

  const titleWeight = num(c.titleWeight, "titleWeight");
  const titleWidth = num(c.titleWidth, "titleWidth");
  if (titleWeight < 100 || titleWeight > 900) throw new Error(`titleWeight must be between 100 and 900, got ${titleWeight}`);
  if (titleWidth < 62 || titleWidth > 125) throw new Error(`titleWidth must be between 62 and 125, got ${titleWidth}`);

  if (typeof c.colors !== "object" || c.colors === null || Array.isArray(c.colors)) throw new Error("colors must be an object like {\"rule\": \"#6A6A88\"}");
  for (const k of Object.keys(c.colors)) if (!["rule", "muted", "guide"].includes(k)) throw new Error(`unknown colors.${k} (use rule, muted or guide)`);

  return Object.freeze({
    template: c.template,
    title: { lines: title.lines.map(upper), explicit: title.explicit },
    titleLines,
    titleWeight,
    titleWidth,
    artist: upper(text(c.artist, "artist")),
    catalog: upper(text(c.catalog, "catalog")),
    year: upper(text(c.year, "year")),
    footerLeft: upper(text(c.footerLeft, "footerLeft")),
    accent: c.accent,
    background: c.background,
    ink: c.ink,
    colors: c.colors,
    grain,
    seed,
    error,
    errorLabel: c.errorLabel === undefined || c.errorLabel === null ? undefined : text(c.errorLabel, "errorLabel"),
    uppercase: Boolean(c.uppercase),
    locale,
  });
}

/** Validate the output half of the settings and fill in the defaults. */
export function resolveOutputs(input = {}) {
  const sizes = (typeof input.sizes === "string" ? input.sizes.split(",") : input.sizes ?? [3000, 1200, 600]).map((v) => num(v, "sizes"));
  if (sizes.length === 0) throw new Error("sizes must list at least one size");
  for (const s of sizes) if (!Number.isInteger(s) || s < 64 || s > 8000) throw new Error(`each size must be a whole number from 64 to 8000, got ${s}`);
  const formats = (typeof input.formats === "string" ? input.formats.split(",") : input.formats ?? OUTPUT_FORMATS).map((f) => String(f).trim().toLowerCase().replace(/^jpeg$/, "jpg"));
  for (const f of formats) if (!OUTPUT_FORMATS.includes(f)) throw new Error(`unknown format "${f}" (use ${OUTPUT_FORMATS.join(", ")})`);
  const name = input.name ?? "cover";
  if (!/^[\w.-]+$/.test(name)) throw new Error(`name may only contain letters, digits, ".", "-" and "_", got "${name}"`);
  return { sizes: [...new Set(sizes)], formats: [...new Set(formats)], svg: Boolean(input.svg), name };
}
