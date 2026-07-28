// Play-once sprite effects (blood splats, bullet impacts, explosions) and
// gib particles (debris that flies out, slows down and fades).

import { sfxBlood } from 'lib/audio.js';
import { S } from 'lib/sprites.js';
import { rand, randInt } from 'lib/util.js';

export function fx(world, sheet, x, y, opts = {}) {
  // the splat is the death sound, so it lives with the animation rather than
  // at each of the three spawn sites (enemy death, player death, dying boss)
  if (sheet === 'blood-splat') sfxBlood();
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

/** burst of debris: each particle is one random frame of `sheet`, thrown in a
    random direction with friction, fading out over its short life */
export function gibBurst(world, sheet, x, y, opts = {}) {
  const count = opts.count === undefined ? 7 : opts.count;
  const frames = S(sheet).meta.count;
  for (let i = 0; i < count; i++) {
    const ang = rand(0, Math.PI * 2);
    const speed = rand(60, 190);
    world.effects.push({
      sheet,
      gib: true,
      frame: randInt(0, frames - 1),
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: rand(0.45, 0.75),
      scale: rand(0.8, 1.3),
      flipX: Math.random() < 0.5,
      flipY: Math.random() < 0.5,
      t: 0,
    });
  }
}

export function updateFx(world, dt) {
  const list = world.effects;
  const friction = Math.pow(0.02, dt);
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    e.t += dt;
    if (e.gib) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vx *= friction;
      e.vy *= friction;
      if (e.t >= e.life) list.splice(i, 1);
    } else if (Math.floor(e.t * e.fps) >= S(e.sheet).meta.count) {
      list.splice(i, 1);
    }
  }
}

export function renderFx(world) {
  for (const e of world.effects) {
    const s = S(e.sheet);
    if (e.gib) {
      const k = e.t / e.life;
      const a = k > 0.6 ? Math.round(128 * (1 - (k - 0.6) / 0.4)) : 128;
      s.draw(e.frame, e.x, e.y, {
        scale: e.scale,
        flipX: e.flipX,
        flipY: e.flipY,
        color: Color.new(255, 255, 255, a),
      });
      continue;
    }
    const frame = Math.min(Math.floor(e.t * e.fps), s.meta.count - 1);
    s.draw(frame, e.x, e.y, { scale: e.scale, flipX: e.flipX, color: e.color });
  }
}
