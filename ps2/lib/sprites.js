// Lazy singleton caches for sheets and whole images. AthenaEnv uploads a
// texture per Image instance, so everything shares one instance per asset.

import { SHEETS } from 'data/sheets.js';
import { Sheet, Pic } from 'lib/sheet.js';

const sheets = new Map();
const pics = new Map();

/** animated/rotated sheet by data/sheets.js name */
export function S(name) {
  let s = sheets.get(name);
  if (!s) {
    s = new Sheet(SHEETS[name]);
    sheets.set(name, s);
  }
  return s;
}

/** plain image by logical name — file names are underscore-only (ISO9660) */
export function P(name) {
  let p = pics.get(name);
  if (!p) {
    p = new Pic(`assets/${name.replace(/-/g, '_')}.png`);
    pics.set(name, p);
  }
  return p;
}
