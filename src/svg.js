// Scene -> SVG text. Type is already outlines, so the SVG needs no fonts and renders the same everywhere.
import { M, MID, W, BRACKET } from "./layout.js";

const HAIR = 1.7; // hairlines stay about 1 output px even on the 600 px thumbnail
const THIN = 1.25;

const regMark = ({ x, y }, r, reach) =>
  `<circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x - reach} ${y}H${x + reach}M${x} ${y - reach}V${y + reach}"/>`;

function corners() {
  const L = BRACKET;
  return [
    `M${M} ${M + L}V${M}H${M + L}`,
    `M${W - M - L} ${M}H${W - M}V${M + L}`,
    `M${M} ${W - M - L}V${W - M}H${M + L}`,
    `M${W - M - L} ${W - M}H${W - M}V${W - M - L}`,
  ].join("");
}

function crosshairBackdrop(p, scene) {
  const ticks = [];
  for (let x = 110; x <= 890; x += 10) ticks.push(`M${x} ${MID}V${MID + ((x - MID) % 50 === 0 ? 13 : 6)}`);
  const vticks = [];
  for (let y = 110; y <= 890; y += 10) vticks.push(`M${MID} ${y}H${MID - ((y - MID) % 50 === 0 ? 13 : 6)}`);
  return `
    <path d="M${M} ${MID}H${W - M}M${MID} ${M}V${W - M}" stroke="${p.rule}" stroke-width="${THIN}" stroke-dasharray="26 6 4 6" opacity=".7"/>
    <path d="${ticks.join("")}${vticks.join("")}" stroke="${p.rule}" stroke-width="${THIN}" opacity=".75"/>
    <circle cx="${MID}" cy="${MID}" r="${scene.cross.R}" stroke="${p.guide}" stroke-width="${HAIR}" stroke-dasharray="9 7"/>`;
}

function gridBackdrop(p) {
  const STEP = 40;
  const KX = 10; // vertical lines at x = 100 ... 900
  const KY = 9; // horizontal lines at y = 140 ... 860, clear of the label rows
  const minor = [];
  const major = [];
  const plus = [];
  const x = (k) => MID + k * STEP;
  for (let k = -KX; k <= KX; k++) (k % 4 === 0 ? major : minor).push(`M${x(k)} ${x(-KY)}V${x(KY)}`);
  for (let k = -KY; k <= KY; k++) (k % 4 === 0 ? major : minor).push(`M${x(-KX)} ${x(k)}H${x(KX)}`);
  for (let i = -8; i <= 8; i += 4) for (let j = -8; j <= 8; j += 4) plus.push(`M${x(i) - 7} ${x(j)}h14M${x(i)} ${x(j) - 7}v14`);
  return `
    <path d="${minor.join("")}" stroke="${p.rule}" stroke-width="${THIN}" opacity=".28"/>
    <path d="${major.join("")}" stroke="${p.rule}" stroke-width="${THIN}" opacity=".6"/>
    <path d="${plus.join("")}" stroke="${p.muted}" stroke-width="${HAIR}"/>`;
}

/** @param {ReturnType<import("./layout.js").buildScene>} scene @param {number} px output size in pixels */
export function toSvg(scene, px) {
  const p = scene.palette;
  const type = scene.titleLines.map((l) => l.d).join("");
  const byId = Object.fromEntries(scene.labels.map((l) => [l.id, l]));
  const mutedLabels = ["catalog", "footerLeft", "year"].filter((id) => byId[id]).map((id) => byId[id].d).join("");
  const crossParts = [];
  let front = "";
  if (scene.cross) {
    const { T, R, reach, label } = scene.cross;
    const mark = regMark(T, R, reach);
    crossParts.push(`<g fill="none" stroke="${p.accent}" stroke-width="${HAIR}">${mark}</g>`);
    // where the accent lines cross the title they are cut out of the letters, like a misregistered plate
    crossParts.push(`<g fill="none" stroke="${p.bg}" stroke-width="${HAIR + 0.3}" clip-path="url(#type)">${mark}</g>`);
    if (label) crossParts.push(`<path d="${label.d}" fill="${p.accent}"/>`);
  } else {
    // grid template: one short accent bar under the title
    const y = scene.titleBottom + 38;
    front = `<rect x="${MID - 36}" y="${y}" width="72" height="6" fill="${p.accent}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${W} ${W}">
  <defs>
    <radialGradient id="g" cx="50%" cy="47%" r="75%">
      <stop offset="0" stop-color="${p.bgCenter}"/>
      <stop offset=".6" stop-color="${p.bg}"/>
      <stop offset="1" stop-color="${p.bgEdge}"/>
    </radialGradient>
    <clipPath id="type"><path d="${type}"/></clipPath>
  </defs>
  <rect width="${W}" height="${W}" fill="url(#g)"/>
  <g fill="none" stroke-linecap="butt">${scene.cross ? crosshairBackdrop(p, scene) : gridBackdrop(p)}
    <path d="${corners()}" stroke="${p.rule}" stroke-width="${HAIR}"/>
  </g>
  <path d="${type}" fill="${p.ink}"/>
  ${crossParts.join("\n  ")}
  ${front}
  ${byId.artist ? `<path d="${byId.artist.d}" fill="${p.ink}"/>` : ""}
  ${mutedLabels ? `<path d="${mutedLabels}" fill="${scene.cross ? p.muted : p.accent}"/>` : ""}
</svg>
`;
}
