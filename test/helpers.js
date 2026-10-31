import { M, W, MID, overlaps } from "../src/layout.js";
import assert from "node:assert/strict";

/**
 * Geometry checks on a built scene: every piece of text lies inside the frame, no two pieces overlap,
 * nothing touches a corner bracket, and (crosshair) the title keeps clear of the centre line and the
 * cross and its label stay clear of the label rows. Boxes are the real outline bounds, not font metrics.
 */
export function assertClean(scene, label = "") {
  const where = (s) => `${label}: ${s}`;
  const all = [
    ...scene.boxes.title.map((b, i) => ({ id: `title${i + 1}`, ...b })),
    ...scene.boxes.labels,
    ...(scene.boxes.crossLabel ? [{ id: "errorLabel", ...scene.boxes.crossLabel }] : []),
  ];
  for (const b of all) {
    assert.ok(b.x0 >= M + 10 && b.x1 <= W - M - 10 && b.y0 >= M + 10 && b.y1 <= W - M - 10, where(`${b.id} leaves the frame: ${JSON.stringify(b)}`));
    for (const arm of scene.boxes.corners) assert.ok(!overlaps(b, arm, 8), where(`${b.id} is too close to a corner mark`));
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) assert.ok(!overlaps(all[i], all[j], 4), where(`${all[i].id} overlaps ${all[j].id}`));
  }
  for (const b of scene.boxes.labels) {
    // labels keep out of the middle column so they never touch the vertical centre line
    if (b.x0 < MID) assert.ok(b.x1 <= MID - 20, where(`${b.id} reaches the centre line`));
    else assert.ok(b.x0 >= MID + 20, where(`${b.id} reaches the centre line`));
  }
  if (scene.cross) {
    const { T, reach, label } = scene.cross;
    const rowsBottom = Math.max(0, ...scene.boxes.labels.filter((l) => l.y1 < MID).map((l) => l.y1));
    const rowsTop = Math.min(W, ...scene.boxes.labels.filter((l) => l.y0 > MID).map((l) => l.y0));
    assert.ok(T.y - reach >= rowsBottom + 10, where(`the cross reaches into the top label row (${T.y - reach} vs ${rowsBottom})`));
    assert.ok(T.y + reach <= rowsTop - 10, where("the cross reaches into the bottom label row"));
    assert.ok(T.x - reach >= M + 30 && T.x + reach <= W - M - 30, where("the cross arms leave the frame"));
    if (label) assert.ok(label.box.y0 >= rowsBottom + 10, where("the error label touches the top row"));
    // the scale runs along y = 500 with ticks 13 units below it: title ink keeps clear of both sides
    const lines = scene.boxes.title;
    if (lines.length === 2) {
      assert.ok(lines[0].y1 <= MID - 20, where(`line 1 reaches the centre line (${lines[0].y1})`));
      assert.ok(lines[1].y0 >= MID + 20, where(`line 2 reaches the centre line (${lines[1].y0})`));
    } else {
      assert.ok(lines[0].y1 <= MID - 20, where(`the title reaches the centre line (${lines[0].y1})`));
    }
  }
}
