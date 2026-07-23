// The Evil Brain — ported from evil-brain.ts. A composite of top (brain),
// bottom (jaw) and two damageable eyes, drawn at scale 2 (the original's
// scale 4 assumes a 1680x1050 world). Kills require destroying both eyes.

import { BOSS } from 'data/tuning.js';
import { S } from 'lib/sprites.js';
import { fx } from 'lib/fx.js';
import { nearestPlayer } from 'lib/enemies.js';
import { SCREEN_W } from 'lib/util.js';

// part layout in unscaled container coords (from the original's constructor)
const TOP = { x: 0, y: 0, w: 96, h: 58 };
const BOTTOM = { x: 8, y: 58, w: 80, h: 56 };
const EYES = [
  { x: 8 + 12, y: 59, flip: true },
  { x: 8 + 46, y: 59, flip: false },
];
const EYE_W = 22;
const EYE_H = 10;
const MOUTH = { x: 48, y: 34 };

export class Boss {
  constructor(world) {
    const k = BOSS.scale;
    this.world = world;
    this.k = k;
    this.w = TOP.w * k;
    this.h = (TOP.h + BOTTOM.h) * k;
    this.x = SCREEN_W / 2 - this.w / 2; // container top-left
    this.y = 14;
    this.animT = 0;
    this.fireT = BOSS.fireInterval * 0.5;
    this.prefire = null; // {t}
    this.dying = 0;
    this.eyes = EYES.map((e) => ({
      dx: e.x,
      dy: e.y,
      flip: e.flip,
      hp: BOSS.eyeHp,
      sinceBlink: 0,
      blinkT: 0,
      alive: true,
    }));
  }

  eyeCenter(eye) {
    return {
      x: this.x + (eye.dx + EYE_W / 2) * this.k,
      y: this.y + (eye.dy + EYE_H / 2) * this.k,
    };
  }

  /** live eyes as aim/hit targets for auto-aim and bullets */
  aimTargets() {
    const out = [];
    for (const eye of this.eyes) {
      if (!eye.alive) continue;
      const c = this.eyeCenter(eye);
      out.push({ x: c.x, y: c.y, boss: true, eye });
    }
    return out;
  }

  centerX() {
    return this.x + this.w / 2;
  }

  centerY() {
    return this.y + this.h / 2;
  }

  /** bullet hit test; applies damage. Returns true when the hit landed. */
  hitTest(x, y, radius, dmg) {
    for (const eye of this.eyes) {
      if (!eye.alive || eye.blinkT > 0) continue;
      const c = this.eyeCenter(eye);
      const dx = x - c.x;
      const dy = y - c.y;
      const r = radius + (EYE_W / 2) * this.k;
      if (dx * dx + dy * dy > r * r) continue;

      eye.hp -= dmg;
      eye.sinceBlink += dmg;
      if (eye.sinceBlink >= BOSS.blinkEvery) {
        eye.sinceBlink = 0;
        eye.blinkT = BOSS.blinkTime;
      }
      if (eye.hp <= 0) {
        eye.alive = false;
        fx(this.world, 'eye-explode', c.x, c.y, { fps: 12, scale: this.k });
      }
      if (this.eyes.every((e) => !e.alive)) this.dying = 1.2;
      return true;
    }
    return false;
  }

  update(dt) {
    this.animT += dt;
    for (const eye of this.eyes) {
      if (eye.blinkT > 0) eye.blinkT -= dt;
    }

    if (this.dying > 0) {
      this.dying -= dt;
      if (Math.random() < 12 * dt) {
        fx(
          this.world,
          'blood-splat',
          this.x + Math.random() * this.w,
          this.y + Math.random() * this.h,
          { fps: 30, scale: 1.5 },
        );
      }
      if (this.dying <= 0) this.world.onBossDefeated();
      return;
    }

    // prefire telegraph, then a shot at the nearest player
    if (this.prefire) {
      this.prefire.t += dt;
      if (this.prefire.t >= 0.25) {
        this.prefire = null;
        const target = nearestPlayer(this.world, this.centerX(), this.centerY());
        if (target) {
          const mx = this.x + MOUTH.x * this.k;
          const my = this.y + MOUTH.y * this.k;
          const d = Math.sqrt((target.x - mx) ** 2 + (target.y - my) ** 2) || 1;
          this.world.enemyBullets.push({
            x: mx,
            y: my,
            vx: ((target.x - mx) / d) * BOSS.bulletSpeed,
            vy: ((target.y - my) / d) * BOSS.bulletSpeed,
            t: 0,
          });
        }
      }
    } else {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = BOSS.fireInterval;
        this.prefire = { t: 0 };
      }
    }
  }

  render() {
    const k = this.k;
    const topSheet = S('brain-top');
    const bottomSheet = S('brain-bottom');
    const eyeSheet = S('brain-eye');

    const blinkOut = this.dying > 0 && Math.floor(this.dying * 16) % 2 === 0;
    if (blinkOut) return;

    topSheet.draw(topSheet.frameAt(this.animT, 1), this.x + (TOP.x + TOP.w / 2) * k, this.y + (TOP.y + TOP.h / 2) * k, { scale: k });
    bottomSheet.draw(bottomSheet.frameAt(this.animT, 1), this.x + (BOTTOM.x + BOTTOM.w / 2) * k, this.y + (BOTTOM.y + BOTTOM.h / 2) * k, { scale: k });

    const target = nearestPlayer(this.world, this.centerX(), this.centerY());
    for (const eye of this.eyes) {
      if (!eye.alive) continue;
      const c = this.eyeCenter(eye);
      let frame;
      if (eye.blinkT > 0) frame = 0;
      else if (!target) frame = 2;
      else if (target.x < this.x) frame = eye.flip ? 3 : 1;
      else if (target.x > this.x + this.w) frame = eye.flip ? 1 : 3;
      else frame = 2;
      eyeSheet.draw(frame, c.x, c.y, { scale: k, flipX: eye.flip });
    }

    if (this.prefire) {
      const pf = S('brain-prefire');
      const frame = Math.min(Math.floor(this.prefire.t * 12), pf.meta.count - 1);
      pf.draw(frame, this.x + MOUTH.x * k, this.y + MOUTH.y * k, { scale: k });
    }
  }

  /** total remaining eye hp ratio, for the HUD bar */
  hpRatio() {
    let hp = 0;
    for (const eye of this.eyes) if (eye.alive) hp += Math.max(0, eye.hp);
    return hp / (BOSS.eyeHp * this.eyes.length);
  }
}
