// Zombie / alien / spider / beetle / crabfly / lizard horde: wave
// composition, edge spawning, chase / skitter / weave AI, lizard dens that
// hatch reinforcements, death drops. Ported from wave-manager.ts +
// zombie.ts/alien.ts; the spider, beetle, crabfly, lizard and den are new
// to the port (Crimsonland art).

import { ENEMIES, WAVE, POWERUPS } from 'data/tuning.js';
import { S } from 'lib/sprites.js';
import { fx, gibBurst } from 'lib/fx.js';
import { SCREEN_W, SCREEN_H, rand, randInt, pick, hit, clamp } from 'lib/util.js';

let nextId = 1;

/** enemy descriptors for wave n (1-based); boss waves return [] */
export function buildWave(n) {
  const list = [];
  const count = WAVE.baseCount + WAVE.perWave * n;
  const alienChance = Math.min(0.08 * n, 0.55);
  const spiderChance = n >= WAVE.spiderWave ? Math.min(0.1 * (n - WAVE.spiderWave + 1), 0.35) : 0;
  const beetleChance = n >= WAVE.beetleWave ? Math.min(0.07 * (n - WAVE.beetleWave + 1), 0.25) : 0;
  const crabflyChance = n >= WAVE.crabflyWave ? Math.min(0.08 * (n - WAVE.crabflyWave + 1), 0.3) : 0;
  const hpScale = 1 + 0.08 * (n - 1);
  for (let i = 0; i < count; i++) {
    let roll = Math.random();
    let type = 'zombie';
    for (const [t, chance] of [
      ['spider', spiderChance],
      ['beetle', beetleChance],
      ['crabfly', crabflyChance],
      ['alien', alienChance],
    ]) {
      if (roll < chance) {
        type = t;
        break;
      }
      roll -= chance;
    }
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
    // spider skitter state; inert for the chase types
    darting: false,
    dartT: 0,
    dartDir: 0,
    // crabfly weave phase; inert for everyone else
    wobT: rand(0, Math.PI * 2),
  });
}

/** stationary lizard dens for wave n, dropped straight onto the arena floor
    (they don't walk in from an edge). Carry-overs from earlier waves count
    against the quota. Returns how many were placed, for waveTotal. */
export function spawnDens(world, n) {
  if (n < WAVE.denWave) return 0;
  let alive = 0;
  for (const e of world.enemies) if (e.type === 'lizard-den') alive++;
  const want = Math.min(1 + Math.floor((n - WAVE.denWave) / 4), WAVE.denMax);
  const base = ENEMIES['lizard-den'];
  const hpScale = 1 + 0.08 * (n - 1);
  let placed = 0;
  for (let i = alive; i < want; i++) {
    const spot = denSpot(world);
    if (!spot) break;
    world.enemies.push({
      id: nextId++,
      type: 'lizard-den',
      x: spot.x,
      y: spot.y,
      hp: Math.round(base.hp * hpScale),
      speed: 0,
      radius: base.radius,
      animT: rand(0, 1),
      facingLeft: false,
      // hatch clock plus the wave-scaled stats its lizards are born with
      spawnT: rand(1, base.spawn.every),
      brood: 0,
      lizHp: Math.round(ENEMIES.lizard.hp * hpScale),
      lizSpeed: ENEMIES.lizard.speed + 3 * n,
    });
    fx(world, 'smoke', spot.x, spot.y, { fps: 20, scale: 2 });
    placed++;
  }
  return placed;
}

/** a floor spot clear of the walls, every living player and other dens;
    null when nothing qualifies after a couple dozen rolls */
function denSpot(world) {
  for (let tries = 0; tries < 24; tries++) {
    const x = rand(70, SCREEN_W - 70);
    const y = rand(70, SCREEN_H - 70);
    let ok = true;
    for (const p of world.players) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (p.alive && dx * dx + dy * dy < 150 * 150) { ok = false; break; }
    }
    for (const e of world.enemies) {
      if (!ok) break;
      const dx = e.x - x;
      const dy = e.y - y;
      if (e.type === 'lizard-den' && dx * dx + dy * dy < 130 * 130) ok = false;
    }
    if (ok) return { x, y };
  }
  return null;
}

export function updateEnemies(world, dt) {
  for (const e of world.enemies) {
    // freeze powerup: everything locks mid-stride (animT stops too, so the
    // walk cycle holds its frame). shieldActive enemies are exempt — none
    // set it yet; the spiderBoss will when its shield is up.
    if (world.freezeT > 0 && !e.shieldActive) continue;
    if (e.type === 'spider') {
      updateSpider(world, e, dt);
      continue;
    }
    if (e.type === 'lizard-den') {
      updateDen(world, e, dt);
      continue;
    }
    if (e.type === 'crabfly') {
      updateCrabfly(world, e, dt);
      continue;
    }
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

/** dart-and-pause: commit to a jittered heading toward the nearest player
    for the dart's whole duration, rest, re-aim. Legs (animT) only move
    while darting, so paused spiders sit on a frozen frame. */
function updateSpider(world, e, dt) {
  const spec = ENEMIES.spider.dart;
  e.dartT -= dt;
  if (e.darting) {
    e.animT += dt;
    e.x += Math.cos(e.dartDir) * e.speed * spec.mult * dt;
    e.y += Math.sin(e.dartDir) * e.speed * spec.mult * dt;
    // darts don't home mid-flight — keep a bad heading from leaving the arena
    e.x = clamp(e.x, -40, SCREEN_W + 40);
    e.y = clamp(e.y, -40, SCREEN_H + 40);
    if (e.dartT <= 0) {
      e.darting = false;
      e.dartT = rand(spec.pauseMin, spec.pauseMax);
    }
    return;
  }
  if (e.dartT > 0) return;
  const target = nearestPlayer(world, e.x, e.y);
  if (!target) return;
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  // overlapping the player: sit still like the chase types do
  if (Math.sqrt(dx * dx + dy * dy) <= e.radius + 14) return;
  e.dartDir = Math.atan2(dy, dx) + rand(-spec.jitter, spec.jitter);
  e.facingLeft = Math.cos(e.dartDir) < 0;
  e.darting = true;
  e.dartT = rand(spec.minT, spec.maxT);
}

/** close in on the nearest player while swinging side to side — the weave is
    a sine offset perpendicular to the chase direction, so it reads as a fast
    erratic flyer without ever stalling out */
function updateCrabfly(world, e, dt) {
  const spec = ENEMIES.crabfly.weave;
  e.animT += dt;
  e.wobT += dt;
  const target = nearestPlayer(world, e.x, e.y);
  if (!target) return;
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  e.facingLeft = dx < 0;
  if (d <= e.radius + 14) return;
  const wob = Math.sin(e.wobT * spec.freq * Math.PI * 2) * spec.amp;
  e.x += ((dx / d) * e.speed + (-dy / d) * wob) * dt;
  e.y += ((dy / d) * e.speed + (dx / d) * wob) * dt;
}

/** dens don't move — they incubate: a lizard hatches every spawn.every
    seconds until spawn.maxAlive of the brood are up, and losses re-hatch on
    the same clock (the timer holds while full, so a kill is never replaced
    instantly). Hatchlings pop out a step from the mouth in a random
    direction and chase like everything else. */
function updateDen(world, e, dt) {
  const spec = ENEMIES['lizard-den'].spawn;
  e.animT += dt;
  if (e.brood >= spec.maxAlive) {
    e.spawnT = spec.every;
    return;
  }
  e.spawnT -= dt;
  if (e.spawnT > 0) return;
  e.spawnT = spec.every;
  e.brood++;
  const ang = rand(0, Math.PI * 2);
  world.enemies.push({
    id: nextId++,
    type: 'lizard',
    denId: e.id,
    x: e.x + Math.cos(ang) * 20,
    y: e.y + Math.sin(ang) * 20,
    hp: e.lizHp,
    speed: e.lizSpeed,
    radius: ENEMIES.lizard.radius,
    animT: rand(0, 1),
    facingLeft: false,
    darting: false,
    dartT: 0,
    dartDir: 0,
    wobT: rand(0, Math.PI * 2),
  });
}

/** ice tint while the freeze powerup runs; blinks off during the last second
    so the thaw telegraphs. undefined = draw untinted. */
export function freezeTint(world) {
  if (!(world.freezeT > 0)) return undefined;
  if (world.freezeT < 1 && Math.floor(world.freezeT * 8) % 2 === 0) return undefined;
  return Color.new(120, 200, 255, 128);
}

export function renderEnemies(world) {
  const ice = freezeTint(world);
  for (const e of world.enemies) {
    const sheet = S(e.type);
    const meta = ENEMIES[e.type];
    sheet.draw(sheet.frameAt(e.animT, meta.anim), e.x, e.y, {
      flipX: e.facingLeft,
      color: e.shieldActive ? undefined : ice,
    });
  }
}

/** apply damage; returns true if the enemy died */
export function damageEnemy(world, e, dmg, killer) {
  e.hp -= dmg;
  if (e.hp > 0) return false;

  world.enemies.splice(world.enemies.indexOf(e), 1);
  // den-hatched lizards are reinforcements, not part of the wave roster —
  // counting them would let an untouched den clear its own wave
  if (!e.denId) world.waveKills++;
  // free the brood slot so the den re-hatches on its clock
  if (e.denId) {
    for (const d of world.enemies) {
      if (d.id === e.denId) { d.brood--; break; }
    }
  }
  if (e.type === 'spider') fx(world, 'spider-die', e.x, e.y, { fps: 24, flipX: e.facingLeft });
  else if (e.type === 'crabfly') fx(world, 'crabfly-die', e.x, e.y, { fps: 18, flipX: e.facingLeft });
  else if (e.type === 'beetle') gibBurst(world, 'beetle-gib', e.x, e.y);
  else if (e.type === 'lizard') fx(world, 'lizard-die', e.x, e.y, { fps: 24, flipX: e.facingLeft });
  else if (e.type === 'lizard-den') fx(world, 'lizard-den-die', e.x, e.y, { fps: 12 });
  else fx(world, 'blood-splat', e.x, e.y, { fps: 30 });

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
