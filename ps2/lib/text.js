// Bitmap text over the generated Share Tech Mono grid (assets/font.png).
// One text path for browser and PS2 — no TTF loading, no canvas, just
// per-character crops. Glyphs are white; tint via the color option.

import { SHEETS } from 'data/sheets.js';
import { Sheet } from 'lib/sheet.js';

const meta = SHEETS.font;
let sheet = null;

function ensure() {
  if (!sheet) sheet = new Sheet(meta);
  return sheet;
}

export function textWidth(str, scale = 1) {
  return str.length * meta.fw * scale;
}

export function textHeight(scale = 1) {
  return meta.fh * scale;
}

/** draw with top-left anchor */
export function drawText(x, y, str, opts = {}) {
  const s = ensure();
  const scale = opts.scale === undefined ? 1 : opts.scale;
  const cw = meta.fw * scale;
  str = String(str);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 32 || code > 127) continue;
    s.draw(code - meta.first, x + i * cw + cw / 2, y + (meta.fh * scale) / 2, {
      scale,
      color: opts.color,
    });
  }
}

/** draw centered on cx */
export function drawTextCentered(cx, y, str, opts = {}) {
  const scale = opts.scale === undefined ? 1 : opts.scale;
  drawText(cx - textWidth(String(str), scale) / 2, y, str, opts);
}
