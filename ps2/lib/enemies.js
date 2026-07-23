// Zombie / alien horde: wave composition, edge spawning, chase AI,
// death drops. Ported from wave-manager.ts + zombie.ts/alien.ts.

import { ENEMIES, WAVE, POWERUPS } from 'data/tuning.js';
import { S } from 'lib/sprites.js';
import { fx } from 'lib/fx.js';
import { SCREEN_W, SCREEN_H, rand, randInt, pick, hit } from 'lib/util.js';

let nextId = 1;

/** enemy descriptors for wave n (1-based); boss waves return [] */
export function buildWave(n) {
  const list = [];
  const count = WAVE.baseCount + WAVE.perWave * n;
  const alienChance = Math.min(0.08 * n, 0.55);
  const hpScale = 1 + 0.08 * (n - 1);
  for (let i = 0; i < count; i++) {
    const type = Math.random() < alienChance ? 'alien' : 'zombie';
    const base = ENEMIES[type];
    list.push({
      type,
      hp: Math.round(base.hp * hpScale),
      speed: base.speed + 3 * n,
    });
  }
  return list;
}

/** materialize a descriptor at a random arena edge, walking in */
export function spawnEnemy(world, desc) {
  const edge = randInt(0, 3);
  let x, y;
  if (edge === 0) { x = rand(20, SCREEN_W - 20); y = -30; }
  else if (edge === 1) { x = rand(20, SCREEN_W - 20); y = SCREEN_H + 30; }
  else if (edge === 2) { x = -30; y = rand(20, SCREEN_H - 20); }
  else { x = SCREEN_W + 30; y = rand(20, SCREEN_H - 20); }

  world.enemies.push({
    id: nextId++,
    type: desc.type,
    x,
    y,
    hp: desc.hp,
    speed: desc.speed,
    radius: ENEMIES[desc.type].radius,
    animT: rand(0, 1),
    facingLeft: false,
  });
}

export function updateEnemies(world, dt) {
  for (const e of world.enemies) {
    e.animT += dt;
    const target = nearestPlayer(world, e.x, e.y);
    if (!target) continue;
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    e.facingLeft = dx < 0;
    // stop when overlapping the player (zombie.ts stops instead of jittering)
    if (d > e.radius + 14) {
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
    }
  }
}

export function renderEnemies(world) {
  for (const e of world.enemies) {
    const sheet = S(e.type);
    const meta = ENEMIES[e.type];
    sheet.draw(sheet.frameAt(e.animT, meta.anim), e.x, e.y, { flipX: e.facingLeft });
  }
}

/** apply damage; returns true if the enemy died */
export function damageEnemy(world, e, dmg, killer) {
  e.hp -= dmg;
  if (e.hp > 0) return false;

  world.enemies.splice(world.enemies.indexOf(e), 1);
  world.waveKills++;
  fx(world, 'blood-splat', e.x, e.y, { fps: 30 });

  if (killer) killer.xp += ENEMIES[e.type].xp;

  if (Math.random() < POWERUPS.dropChance) {
    world.powerups.push({
      type: pick(POWERUPS.types),
      x: e.x,
      y: e.y,
      t: 0,
    });
  }
  return true;
}

export function nearestPlayer(world, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const p of world.players) {
    if (!p.alive) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function nearestEnemy(world, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const e of world.enemies) {
    const dx = e.x - x;
    const dy = e.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  // boss eyes count as aim targets
  if (world.boss) {
    for (const eye of world.boss.aimTargets()) {
      const dx = eye.x - x;
      const dy = eye.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = eye;
      }
    }
  }
  return best;
}
