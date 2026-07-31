// World camera, ported from shmup-party-phaser4's midpoint-follow rig
// (_main.ts: cam.startFollow(mid, ...) + the player-spread zoom) and mapped
// onto this port's units: phaser4's zoom range [1, 2] over a world the size
// of its viewport becomes [ZOOM_MIN, ZOOM_MAX] = [0.5, 1.0] over the 2x
// screen world — min zoom frames the whole arena, max zoom is native pixels.
//
// Improvements over the original: the follow and zoom lerps are exponential
// and frame-rate independent (phaser4 applies 0.05/frame at whatever rate
// RAF gives it), and zoom glides on its own lerp everywhere — phaser4 snaps
// (ZOOM_LERP = 1) and hard-sets 2 for a lone player, which pops on
// join/death transitions.
//
// Rendering hooks: camBegin(cam)/camEnd() bracket world-space drawing;
// lib/sheet.js reads the active camera to transform (and cull) every
// Sheet/Pic draw inside the bracket. HUD and overlays draw outside it.

import { SCREEN_W, SCREEN_H, WORLD_W, WORLD_H, clamp } from 'lib/util.js';

export const ZOOM_MIN = Math.max(SCREEN_W / WORLD_W, SCREEN_H / WORLD_H);
export const ZOOM_MAX = 1;
const FOLLOW_LERP = 0.05; // phaser4's FOLLOW_LERP_X/Y, per 60Hz frame
const ZOOM_LERP = 0.08;   // per 60Hz frame
const SPREAD_FIT = 1.5;   // phaser4: min(view w, view h) / 1.5 / player spread

export function makeCamera() {
  return { x: WORLD_W / 2, y: WORLD_H / 2, zoom: ZOOM_MAX };
}

let active = null;

export function camBegin(cam) {
  active = cam;
}

export function camEnd() {
  active = null;
}

/** the camera the current draw call should look through (null = HUD space) */
export function camera() {
  return active;
}

/**
 * Ease toward the midpoint of `players` (the living ones — the caller
 * filters), zooming to fit their spread. `snap` jumps straight to the
 * target — for scene entries where a glide from the old shot would read
 * as a mistake.
 */
export function updateCamera(cam, players, dt, snap) {
  let tx = cam.x;
  let ty = cam.y;
  let tz = cam.zoom;
  if (players.length > 0) {
    tx = 0;
    ty = 0;
    for (const p of players) {
      tx += p.x;
      ty += p.y;
    }
    tx /= players.length;
    ty /= players.length;

    if (players.length === 1) {
      tz = ZOOM_MAX;
    } else {
      let maxDist = 0;
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const dx = players[j].x - players[i].x;
          const dy = players[j].y - players[i].y;
          const d = dx * dx + dy * dy;
          if (d > maxDist) maxDist = d;
        }
      }
      maxDist = Math.sqrt(maxDist);
      tz = clamp(Math.min(SCREEN_W, SCREEN_H) / SPREAD_FIT / Math.max(maxDist, 1), ZOOM_MIN, ZOOM_MAX);
    }
  }

  const kf = snap ? 1 : 1 - Math.pow(1 - FOLLOW_LERP, dt * 60);
  const kz = snap ? 1 : 1 - Math.pow(1 - ZOOM_LERP, dt * 60);
  cam.x += (tx - cam.x) * kf;
  cam.y += (ty - cam.y) * kf;
  cam.zoom += (tz - cam.zoom) * kz;

  // never show past the world edge (phaser4's setBounds clamp)
  const hw = SCREEN_W / 2 / cam.zoom;
  const hh = SCREEN_H / 2 / cam.zoom;
  cam.x = clamp(cam.x, hw, WORLD_W - hw);
  cam.y = clamp(cam.y, hh, WORLD_H - hh);
}
