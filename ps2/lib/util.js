// Small math/collision helpers shared by every system.
// Runs on AthenaEnv (QuickJS) and in the browser via 5velte-ps2 — keep it
// dependency-free and ES2020-safe.

export const SCREEN_W = 640;
export const SCREEN_H = 448;

// The arena is twice the screen per axis, mirroring shmup-party-phaser4's
// camera model: its 1680x1050 world equals one full view at min zoom and
// half a world per axis at max/solo zoom. 2x per axis gives the same shape
// here — the whole world fits the screen exactly at zoom 0.5 (no letterbox,
// PS2 aspect preserved) and max zoom 1.0 draws sprites at native pixels.
export const WORLD_W = SCREEN_W * 2;
export const WORLD_H = SCREEN_H * 2;

export function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

export function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function angleTo(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1);
}

/** circle-vs-circle overlap on entity centers */
export function hit(a, b, ra, rb) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const r = ra + rb;
  return dx * dx + dy * dy <= r * r;
}

/** heading (radians, screen coords) -> 16-direction rotation frame index */
export function dirFrame(heading) {
  const step = (Math.PI * 2) / 16;
  return ((Math.round(heading / step) % 16) + 16) % 16;
}
