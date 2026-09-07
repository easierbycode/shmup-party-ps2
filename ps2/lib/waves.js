// The authored wave list the arena plays before its procedural waves —
// data/waves.js as baked into the ISO / NRO / web build, unless the browser
// host swapped in another one: the Wave Editor's TEST button opens
// play/?waves=... and src/web/waves-param.ts parks that list on
// globalThis.SHMUP_WAVES before the game boots. Real hardware never sets
// it, so there the baked file is the only source.

import { WAVES } from 'data/waves.js';

export function authoredWaves() {
  const override = globalThis.SHMUP_WAVES;
  return Array.isArray(override) ? override : WAVES;
}

/** the authored entry for wave n (1-based), or null past the list */
export function authoredWave(n) {
  const wave = authoredWaves()[n - 1];
  return wave && typeof wave === 'object' ? wave : null;
}

/** the wave a run opens on: 1, unless the browser host was asked to start
    later (play/?wave=n — the editor testing the wave on its screen) */
export function startWave() {
  const n = globalThis.SHMUP_START_WAVE;
  return Number.isInteger(n) && n > 1 ? n : 1;
}
