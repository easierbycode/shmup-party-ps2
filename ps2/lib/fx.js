// Play-once sprite effects (blood splats, bullet impacts, explosions).

import { S } from 'lib/sprites.js';

export function fx(world, sheet, x, y, opts = {}) {
  world.effects.push({
    sheet,
    x,
    y,
    fps: opts.fps === undefined ? 30 : opts.fps,
    scale: opts.scale === undefined ? 1 : opts.scale,
    flipX: !!opts.flipX,
    color: opts.color,
    t: 0,
  });
}

export function updateFx(world, dt) {
  const list = world.effects;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    e.t += dt;
    if (Math.floor(e.t * e.fps) >= S(e.sheet).meta.count) list.splice(i, 1);
  }
}

export function renderFx(world) {
  for (const e of world.effects) {
    const s = S(e.sheet);
    const frame = Math.min(Math.floor(e.t * e.fps), s.meta.count - 1);
    s.draw(frame, e.x, e.y, { scale: e.scale, flipX: e.flipX, color: e.color });
  }
}
