// The arena. Ported from game-scene.ts / survival-scene.ts + player.ts:
// twin-stick players (right stick aims + fires, auto-aim on CROSS for
// stickless setups), R1 cycles weapons, L1 barrier-dash, START pauses,
// SELECT restarts. Endless waves with the Evil Brain every 5th wave.

import { PLAYER, WEAPONS, WAVE, POWERUPS, PERKS, XP_PER_LEVEL, BOSS } from 'data/tuning.js';
import { S, P } from 'lib/sprites.js';
import { fx, updateFx, renderFx } from 'lib/fx.js';
import { buzz, updateHaptics, stopHaptics } from 'lib/haptics.js';
import { sfx, tickAudio } from 'lib/audio.js';
import { screens } from 'lib/screens.js';
import { pollPad, connectedPorts } from 'lib/input.js';
import { buildWave, spawnEnemy, spawnDens, updateEnemies, renderEnemies, damageEnemy, nearestEnemy } from 'lib/enemies.js';
import { Boss } from 'lib/boss.js';
import { drawText, drawTextCentered, textWidth } from 'lib/text.js';
import { SCREEN_W, SCREEN_H, clamp, hit } from 'lib/util.js';

const WHITE = () => Color.new(255, 255, 255, 128);
const GREEN = () => Color.new(156, 255, 107, 128);
const RED = () => Color.new(255, 64, 64, 128);
const YELLOW = () => Color.new(246, 255, 74, 128);

const POWERUP_PICS = {
  speed: 'powerup-speed',
  fireblast: 'powerup-fireblast',
  boost: 'powerup-boost',
  medikit: 'powerup-medikit',
  nuke: 'powerup-nuke',
  freeze: 'powerup-freeze',
};

export function makePlayer(port, index) {
  return {
    port,
    index,
    skin: PLAYER.skins[index % PLAYER.skins.length],
    x: SCREEN_W / 2 + (index % 2 === 0 ? -60 : 60),
    y: SCREEN_H / 2 + (index < 2 ? -40 : 40),
    heading: index % 2 === 0 ? 0 : Math.PI,
    hp: PLAYER.hp,
    maxHp: PLAYER.hp,
    alive: true,
    invulnT: 0,
    kbx: 0,
    kby: 0,
    weapon: 0,
    cooldown: 0,
    dashT: 0,
    dashCd: 0,
    dashDir: 0,
    dashHits: null,
    speedT: 0,
    giantT: 0,
    // chomp ball: remaining time, orbit angle, and per-target hit cooldowns
    // (enemy id -> seconds left; the boss uses the 'boss' key)
    chompT: 0,
    chompAng: 0,
    chompHits: null,
    xp: 0,
    level: 1,
    perkSpeed: 1,
    perkRate: 1,
    perkDmg: 1,
    animT: 0,
  };
}

export default class GameScreen {
  onEnter() {
    this.makeWorld();
    this.joined = new Set();
    for (const port of connectedPorts()) this.join(port);
    this.nextWave();
  }

  makeWorld() {
    this.world = {
      players: [],
      enemies: [],
      bullets: [],
      enemyBullets: [],
      powerups: [],
      effects: [],
      nukes: [],
      boss: null,
      wave: 0,
      score: 0,
      kills: 0,
      pending: [],
      waveTotal: 0,
      waveKills: 0,
      trickleT: 0,
      breatherT: 0,
      banner: null,
      paused: false,
      overT: 0,
      flashT: 0,
      freezeT: 0,
      perkQueue: [],
      perkOpen: null,
      onBossDefeated: () => this.bossDefeated(),
    };
  }

  /** how player p reads its pad this frame — the demo screen answers with a
      synthetic pad for its AI troopers */
  padFor(p) {
    return pollPad(p.port);
  }

  onExit() {
    stopHaptics();
  }

  join(port) {
    if (this.joined.has(port)) return;
    this.joined.add(port);
    this.world.players.push(makePlayer(port, this.world.players.length));
  }

  banner(text, color, big) {
    this.world.banner = { text, color, t: 0, scale: big ? 4 : 3 };
  }

  nextWave() {
    const w = this.world;
    w.wave++;
    w.waveKills = 0;
    w.breatherT = 0;
    if (w.wave % WAVE.bossEvery === 0) {
      this.banner('BOSS INCOMING!', RED());
      for (const p of w.players) if (p.alive) buzz(p.port, 'bossIncoming');
      w.pending = [];
      w.waveTotal = 1;
      w.bossPendingT = 1.6;
    } else {
      this.banner(`WAVE ${w.wave}`, WHITE());
      w.pending = buildWave(w.wave);
      // dens and nests land on the floor right away and count toward the
      // wave roster (their hatched brood doesn't — see damageEnemy)
      w.waveTotal = w.pending.length + spawnDens(w, w.wave);
    }
  }

  bossDefeated() {
    const w = this.world;
    w.boss = null;
    w.flashT = 0.5;
    fx(w, 'eye-explode', SCREEN_W / 2, 120, { fps: 12, scale: 3 });
    for (const p of w.players) if (p.alive) buzz(p.port, 'bossDown');
    for (const p of w.players) if (p.alive) p.xp += BOSS.xp;
    w.score += BOSS.score;
    w.kills++;
    w.waveKills = w.waveTotal;
    w.breatherT = WAVE.breather;
    this.banner(`WAVE ${w.wave} CLEAR`, GREEN());
  }

  // ── update ────────────────────────────────────────────────────────────────

  update(dt) {
    const w = this.world;

    // runs before the pause/perk/game-over early returns so in-flight
    // rumble pulses always decay instead of sticking on
    updateHaptics(dt);
    tickAudio(dt);

    // controller hotplug (a second PS2 pad joins mid-run)
    for (const port of connectedPorts()) this.join(port);

    // perk overlay swallows the frame
    if (w.perkOpen) {
      this.updatePerkOverlay();
      return;
    }
    if (w.perkQueue.length > 0) {
      w.perkOpen = { player: w.perkQueue.shift(), idx: 1 };
      return;
    }

    const anyPad = pollPad(this.world.players[0] ? this.world.players[0].port : 0);
    const alive = w.players.filter((p) => p.alive);

    // game over flow: let the banner land, then hand the run's tally to the
    // leaderboard screen
    if (w.overT > 0) {
      w.overT -= dt;
      if (w.overT <= 0) {
        screens.change('gameover', {
          score: w.score,
          wave: w.wave,
          kills: w.kills,
          players: w.players.length,
        });
      }
      return;
    }
    if (w.players.length > 0 && alive.length === 0) {
      this.banner('GAME OVER', RED(), true);
      w.overT = 2.5;
      return;
    }

    // pause — any player's START
    for (const p of w.players) {
      const pad = pollPad(p.port);
      if (pad.just(Pads.START)) w.paused = !w.paused;
      if (pad.just(Pads.SELECT)) {
        this.onEnter(); // restart the run, matching the original's SELECT
        return;
      }
    }
    if (w.paused) return;

    if (w.banner) {
      w.banner.t += dt;
      if (w.banner.t > 3.2) w.banner = null;
    }
    if (w.flashT > 0) w.flashT -= dt;
    if (w.freezeT > 0) w.freezeT -= dt;

    this.updateSpawning(dt);
    for (const p of w.players) this.updatePlayer(p, dt);
    updateEnemies(w, dt);
    if (w.boss) w.boss.update(dt);
    this.updateBullets(dt);
    this.updateEnemyBullets(dt);
    this.updatePowerups(dt);
    this.updateNukes(dt);
    updateFx(w, dt);
    this.checkWaveEnd(dt);
    void anyPad;
  }

  updateSpawning(dt) {
    const w = this.world;
    if (w.bossPendingT !== undefined && w.bossPendingT > 0) {
      w.bossPendingT -= dt;
      if (w.bossPendingT <= 0) {
        w.boss = new Boss(w);
        w.bossPendingT = undefined;
      }
      return;
    }
    if (w.pending.length === 0) return;
    w.trickleT -= dt;
    if (w.enemies.length < WAVE.maxAlive && w.trickleT <= 0) {
      spawnEnemy(w, w.pending.shift());
      w.trickleT = WAVE.trickle;
    }
  }

  checkWaveEnd(dt) {
    const w = this.world;
    if (w.breatherT > 0) {
      w.breatherT -= dt;
      if (w.breatherT <= 0) this.nextWave();
      return;
    }
    if (w.boss || (w.bossPendingT !== undefined && w.bossPendingT > 0)) return;
    if (w.waveTotal > 0 && w.waveKills >= Math.ceil(w.waveTotal * WAVE.clearRatio)) {
      w.waveTotal = 0;
      w.breatherT = WAVE.breather;
    }
  }

  updatePlayer(p, dt) {
    const w = this.world;
    if (!p.alive) return;

    // level-ups — xp accrues wherever kills happen (damageEnemy, boss)
    while (p.xp >= p.level * XP_PER_LEVEL) {
      p.xp -= p.level * XP_PER_LEVEL;
      p.level++;
      w.perkQueue.push(p);
    }

    p.animT += dt;
    if (p.invulnT > 0) p.invulnT -= dt;
    if (p.speedT > 0) p.speedT -= dt;
    if (p.giantT > 0) p.giantT -= dt;
    if (p.chompT > 0) {
      p.chompT -= dt;
      if (p.chompT <= 0) p.chompHits = null;
    }
    if (p.cooldown > 0) p.cooldown -= dt;
    if (p.dashCd > 0) p.dashCd -= dt;

    const pad = this.padFor(p);

    // barrier dash (L1)
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += Math.cos(p.dashDir) * PLAYER.dash.speed * dt;
      p.y += Math.sin(p.dashDir) * PLAYER.dash.speed * dt;
      for (const e of [...w.enemies]) {
        if (!p.dashHits.has(e.id) && hit(p, e, PLAYER.dash.radius, e.radius)) {
          p.dashHits.add(e.id);
          damageEnemy(w, e, PLAYER.dash.damage * p.perkDmg, p);
        }
      }
    } else {
      if (pad.just(Pads.L1) && p.dashCd <= 0) {
        buzz(p.port, 'dash');
        sfx('dash');
        p.dashT = PLAYER.dash.time;
        p.dashCd = PLAYER.dash.cooldown;
        p.dashDir = p.heading;
        p.dashHits = new Set();
        // endGrace: a couple of iframes past the dash so stopping inside
        // the crowd doesn't hurt on the very next frame
        p.invulnT = Math.max(p.invulnT, PLAYER.dash.time + PLAYER.dash.endGrace);
      }

      // movement: d-pad or left stick
      let mx = pad.lx;
      let my = pad.ly;
      if (pad.held(Pads.LEFT)) mx = -1;
      else if (pad.held(Pads.RIGHT)) mx = 1;
      if (pad.held(Pads.UP)) my = -1;
      else if (pad.held(Pads.DOWN)) my = 1;
      const mlen = Math.sqrt(mx * mx + my * my);
      if (mlen > 1) {
        mx /= mlen;
        my /= mlen;
      }
      const speed = PLAYER.speed * p.perkSpeed * (p.speedT > 0 ? POWERUPS.speedMult : 1);
      p.x += mx * speed * dt;
      p.y += my * speed * dt;
    }

    // knockback decay
    p.x += p.kbx * dt;
    p.y += p.kby * dt;
    p.kbx *= Math.pow(0.002, dt);
    p.kby *= Math.pow(0.002, dt);

    p.x = clamp(p.x, 20, SCREEN_W - 20);
    p.y = clamp(p.y, 20, SCREEN_H - 20);

    // weapon cycling (R1)
    if (pad.just(Pads.R1)) {
      p.weapon = (p.weapon + 1) % WEAPONS.length;
      sfx('switch');
    }

    // aim + fire: right stick is twin-stick; CROSS auto-aims (cabinet mode)
    let firing = false;
    if (pad.rx !== 0 || pad.ry !== 0) {
      p.heading = Math.atan2(pad.ry, pad.rx);
      firing = true;
    } else if (pad.held(Pads.CROSS) || pad.held(Pads.R2)) {
      const target = nearestEnemy(w, p.x, p.y);
      if (target) {
        p.heading = Math.atan2(target.y - p.y, target.x - p.x);
        firing = true;
      }
    }
    if (firing && p.cooldown <= 0 && p.dashT <= 0) this.fire(p);

    // orbiting chomp ball — runs after movement so it swings from where the
    // player ended up this frame
    if (p.chompT > 0) this.updateChomp(p, dt);

    // enemy contact: while giant the player is untouchable and poisonous —
    // anything that runs into them melts instead of landing a hit
    if (p.giantT > 0) {
      const r = PLAYER.radius * POWERUPS.giantScale;
      for (const e of [...w.enemies]) {
        if (hit(p, e, r, e.radius)) {
          damageEnemy(w, e, POWERUPS.giantTouchDps * p.perkDmg * dt, p);
        }
      }
    } else if (p.invulnT <= 0) {
      for (const e of w.enemies) {
        if (hit(p, e, PLAYER.radius, e.radius)) {
          this.hurtPlayer(p, e.x, e.y);
          break;
        }
      }
      if (p.alive && w.boss && !w.boss.dying) {
        const bx = w.boss.centerX();
        const by = w.boss.centerY();
        const dx = p.x - bx;
        const dy = p.y - by;
        if (dx * dx + dy * dy < BOSS.touchRadius * BOSS.touchRadius) {
          this.hurtPlayer(p, bx, by);
        }
      }
    }
  }

  /** where p's chomp ball sits this frame */
  chompPos(p) {
    return {
      x: p.x + Math.cos(p.chompAng) * POWERUPS.chompRadius,
      y: p.y + Math.sin(p.chompAng) * POWERUPS.chompRadius,
    };
  }

  updateChomp(p, dt) {
    const w = this.world;
    p.chompAng += POWERUPS.chompSpin * dt;
    if (p.chompAng > Math.PI * 2) p.chompAng -= Math.PI * 2;

    // tick the per-target cooldowns down; deleting during the walk is safe on
    // a Map iterator
    for (const [id, left] of p.chompHits) {
      if (left - dt <= 0) p.chompHits.delete(id);
      else p.chompHits.set(id, left - dt);
    }

    const ball = this.chompPos(p);
    for (const e of [...w.enemies]) {
      if (p.chompHits.has(e.id)) continue;
      if (!hit(ball, e, POWERUPS.chompBallRadius, e.radius)) continue;
      p.chompHits.set(e.id, POWERUPS.chompHit);
      damageEnemy(w, e, POWERUPS.chompDamage * p.perkDmg, p);
    }

    if (w.boss && !w.boss.dying && !p.chompHits.has('boss')) {
      const landed = w.boss.hitTest(
        ball.x,
        ball.y,
        POWERUPS.chompBallRadius,
        POWERUPS.chompDamage * p.perkDmg,
      );
      if (landed) p.chompHits.set('boss', POWERUPS.chompHit);
    }
  }

  hurtPlayer(p, fromX, fromY) {
    p.hp--;
    buzz(p.port, p.hp <= 0 ? 'death' : 'hurt');
    const ang = Math.atan2(p.y - fromY, p.x - fromX);
    p.kbx = Math.cos(ang) * PLAYER.knockback;
    p.kby = Math.sin(ang) * PLAYER.knockback;
    p.invulnT = PLAYER.invulnAfterHit;
    if (p.hp <= 0) {
      p.alive = false;
      fx(this.world, 'blood-splat', p.x, p.y, { fps: 30 });
    }
  }

  fire(p) {
    const spec = WEAPONS[p.weapon];
    p.cooldown = spec.rate * p.perkRate;
    sfx(spec.sfx);
    const off = PLAYER.muzzle[p.skin];
    this.world.bullets.push({
      spec,
      x: p.x + Math.cos(p.heading) * off,
      y: p.y + Math.sin(p.heading) * off,
      vx: Math.cos(p.heading) * spec.speed,
      vy: Math.sin(p.heading) * spec.speed,
      heading: p.heading,
      dmg: spec.dmg * p.perkDmg,
      t: 0,
      life: spec.life,
      owner: p,
      hits: spec.pierce ? new Set() : null,
    });
  }

  updateBullets(dt) {
    const w = this.world;
    for (let i = w.bullets.length - 1; i >= 0; i--) {
      const b = w.bullets[i];
      b.t += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let dead = b.t > b.life || b.x < -20 || b.x > SCREEN_W + 20 || b.y < -20 || b.y > SCREEN_H + 20;

      if (!dead) {
        for (const e of [...w.enemies]) {
          if (!hit(b, e, b.spec.radius, e.radius)) continue;
          if (b.hits) {
            if (b.hits.has(e.id)) continue;
            b.hits.add(e.id);
          }
          if (b.spec.impact) fx(w, b.spec.impact, e.x, e.y, { fps: 30 });
          if (b.spec.hitSfx) sfx(b.spec.hitSfx);
          damageEnemy(w, e, b.dmg, b.owner);
          if (!b.hits) {
            dead = true;
            break;
          }
        }
        if (!dead && w.boss && !w.boss.dying && w.boss.hitTest(b.x, b.y, b.spec.radius, b.dmg)) {
          if (b.spec.impact) fx(w, b.spec.impact, b.x, b.y, { fps: 30 });
          if (b.spec.hitSfx) sfx(b.spec.hitSfx);
          if (!b.hits) dead = true;
        }
      }

      if (dead) w.bullets.splice(i, 1);
    }
  }

  updateEnemyBullets(dt) {
    const w = this.world;
    for (let i = w.enemyBullets.length - 1; i >= 0; i--) {
      const b = w.enemyBullets[i];
      b.t += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let dead = b.x < -20 || b.x > SCREEN_W + 20 || b.y < -20 || b.y > SCREEN_H + 20;
      if (!dead) {
        for (const p of w.players) {
          if (!p.alive || p.invulnT > 0 || p.giantT > 0) continue;
          if (hit(b, p, BOSS.bulletRadius, PLAYER.radius)) {
            this.hurtPlayer(p, b.x, b.y);
            dead = true;
            break;
          }
        }
      }
      if (dead) w.enemyBullets.splice(i, 1);
    }
  }

  updatePowerups(dt) {
    const w = this.world;
    for (let i = w.powerups.length - 1; i >= 0; i--) {
      const pu = w.powerups[i];
      pu.t += dt;
      if (pu.t > POWERUPS.lifespan) {
        w.powerups.splice(i, 1);
        continue;
      }
      for (const p of w.players) {
        if (!p.alive) continue;
        if (!hit(pu, p, POWERUPS.radius, PLAYER.radius)) continue;
        this.applyPowerup(p, pu);
        w.powerups.splice(i, 1);
        break;
      }
    }
  }

  applyPowerup(p, pu) {
    const w = this.world;
    buzz(p.port, 'pickup');
    switch (pu.type) {
      case 'speed':
        p.speedT = POWERUPS.speedTime;
        break;
      case 'boost':
        p.giantT = POWERUPS.giantTime;
        break;
      case 'medikit':
        p.hp = Math.min(p.hp + 1, p.maxHp);
        break;
      case 'chomp':
        // re-collecting refreshes the duration rather than stacking a second ball
        p.chompT = POWERUPS.chompTime;
        p.chompHits = new Map();
        break;
      case 'freeze':
        // world-level, not per-player: the whole horde (and the boss) locks
        // up for everyone. Re-collecting refreshes the clock.
        w.freezeT = POWERUPS.freezeTime;
        break;
      case 'nuke':
        w.nukes.push({ x: pu.x, y: pu.y, t: 0, hits: new Set() });
        w.flashT = 0.4;
        // the blast fills the arena, so everyone feels it
        for (const q of w.players) if (q.alive) buzz(q.port, 'nuke');
        break;
      case 'fireblast': {
        sfx('fireblast');
        const spec = WEAPONS[0];
        for (let i = 0; i < POWERUPS.fireblastCount; i++) {
          const a = (i / POWERUPS.fireblastCount) * Math.PI * 2;
          w.bullets.push({
            spec: { ...spec, sheet: 'bullet', fps: 12, radius: 8, impact: null },
            x: pu.x,
            y: pu.y,
            vx: Math.cos(a) * POWERUPS.fireblastSpeed,
            vy: Math.sin(a) * POWERUPS.fireblastSpeed,
            heading: a,
            dmg: POWERUPS.fireblastDmg * p.perkDmg,
            t: 0,
            life: 1.5,
            owner: p,
            hits: null,
          });
        }
        break;
      }
    }
  }

  updateNukes(dt) {
    const w = this.world;
    for (let i = w.nukes.length - 1; i >= 0; i--) {
      const n = w.nukes[i];
      n.t += dt;
      const r = (n.t / POWERUPS.nukeTime) * POWERUPS.nukeRadius;
      for (const e of [...w.enemies]) {
        if (n.hits.has(e.id)) continue;
        const dx = e.x - n.x;
        const dy = e.y - n.y;
        if (dx * dx + dy * dy <= r * r) {
          n.hits.add(e.id);
          damageEnemy(w, e, POWERUPS.nukeDamage, null);
        }
      }
      if (n.t >= POWERUPS.nukeTime) w.nukes.splice(i, 1);
    }
  }

  updatePerkOverlay() {
    const w = this.world;
    const p = w.perkOpen.player;
    const pad = pollPad(p.port);
    if (pad.just(Pads.LEFT)) w.perkOpen.idx = (w.perkOpen.idx + PERKS.length - 1) % PERKS.length;
    if (pad.just(Pads.RIGHT)) w.perkOpen.idx = (w.perkOpen.idx + 1) % PERKS.length;
    if (pad.just(Pads.CROSS) || pad.just(Pads.START)) {
      sfx('button_press');
      this.applyPerk(p, PERKS[w.perkOpen.idx]);
      w.perkOpen = null;
    }
  }

  applyPerk(p, perk) {
    if (perk.type === 'speed') p.perkSpeed *= 1.2;
    else if (perk.type === 'fireRate') p.perkRate *= 0.8;
    else if (perk.type === 'damage') p.perkDmg *= 1.5;
  }

  // ── render ────────────────────────────────────────────────────────────────

  render() {
    this.renderWorld();
    this.renderHud();
    if (this.world.perkOpen) this.renderPerkOverlay();
  }

  /** arena + everything living in it — shared with the demo screen, which
      swaps the HUD for its own attract overlay */
  renderWorld() {
    const w = this.world;
    P('bg').draw(0, 0);

    // powerups (blink near expiry)
    for (const pu of w.powerups) {
      const left = POWERUPS.lifespan - pu.t;
      if (left < 3 && Math.floor(pu.t * 8) % 2 === 0) continue;
      if (pu.type === 'chomp') {
        // the pickup is the ball itself, so it chomps where it lies
        const ball = S('chomp-ball');
        ball.draw(ball.frameAt(pu.t, 12), pu.x, pu.y);
      } else {
        P(POWERUP_PICS[pu.type]).center(pu.x, pu.y);
      }
    }

    renderEnemies(w);
    if (w.boss) w.boss.render();

    for (const p of w.players) this.renderPlayer(p);
    // drawn outside renderPlayer so the player's invulnerability blink doesn't
    // strobe the ball along with them
    for (const p of w.players) this.renderChomp(p);
    this.renderBullets();
    renderFx(w);
    this.renderNukes();

    // boss bullets
    const bb = S('brain-bullet');
    for (const b of w.enemyBullets) {
      bb.draw(bb.frameAt(b.t, 12), b.x, b.y, { scale: 2 });
    }

    if (w.flashT > 0) {
      const a = Math.min(1, w.flashT / 0.4) * 100;
      Draw.rect(0, 0, SCREEN_W, SCREEN_H, Color.new(255, 240, 200, a));
    }
  }

  renderPlayer(p) {
    if (!p.alive) return;
    // invulnerability blink
    if (p.invulnT > 0 && p.dashT <= 0 && Math.floor(p.invulnT * 12) % 2 === 0) return;
    const scale = p.giantT > 0 ? POWERUPS.giantScale : 1;
    // hurt blink wins over the giant tint; alpha 128 is Athena's neutral
    // multiplier, so these only shift hue, not opacity
    const color = p.invulnT > 0 && p.dashT <= 0
      ? Color.new(255, 90, 90, 128)
      : p.giantT > 0
        ? Color.new(110, 255, 120, 128)
        : undefined;
    // duke's sheet carries a 4-frame walk (12fps, phaser4's duke.walk — and
    // like there, he strides in place while standing); the trooper sheets are
    // single-frame, so dirAt collapses to the plain direction index
    const sheet = S(p.skin);
    sheet.draw(sheet.dirAt(p.heading, p.animT, 12), p.x, p.y, { scale, color });

    if (p.dashT > 0) {
      const bar = S('barrier');
      // pre-rotated to the dash heading; 15fps keeps the two shimmer frames
      // crackling at the old 8-frame/60fps cycle length
      bar.draw(bar.dirAt(p.dashDir, p.animT, 15), p.x + Math.cos(p.dashDir) * 14, p.y + Math.sin(p.dashDir) * 14);
    }
  }

  renderChomp(p) {
    if (!p.alive || p.chompT <= 0) return;
    // blink out the last second so the powerup's end reads before it goes
    if (p.chompT < 1 && Math.floor(p.chompT * 8) % 2 === 0) return;
    const ball = S('chomp-ball');
    const pos = this.chompPos(p);
    ball.draw(ball.frameAt(p.animT, 12), pos.x, pos.y);
  }

  renderBullets() {
    for (const b of this.world.bullets) {
      const sheet = S(b.spec.sheet);
      const fps = b.spec.fps || 12;
      // pre-rotated sheets pick their frame by heading so the projectile points
      // where it flies; the rest have one baked-in orientation and just animate
      const frame = sheet.meta.dirs ? sheet.dirAt(b.heading, b.t, fps) : sheet.frameAt(b.t, fps);
      sheet.draw(frame, b.x, b.y, { scale: b.spec.scale });
    }
  }

  renderNukes() {
    for (const n of this.world.nukes) {
      const k = n.t / POWERUPS.nukeTime;
      const alpha = Math.round(100 * (1 - k * 0.9));
      P('explosion-circle').center(n.x, n.y, {
        w: POWERUPS.nukeRadius * 2 * k,
        h: POWERUPS.nukeRadius * 2 * k,
        color: Color.new(255, 200, 120, alpha),
      });
      P('explosion-skull').center(n.x, n.y, { scale: 1 + k * 2, color: Color.new(255, 255, 255, Math.round(90 * (1 - k))) });
    }
  }

  renderHud() {
    const w = this.world;
    for (const p of w.players) {
      const y = 10 + p.index * 24;
      drawText(10, y, `P${p.index + 1}`, { color: p.alive ? WHITE() : RED() });
      Draw.rect(38, y + 3, 62, 10, Color.new(0, 0, 0, 80));
      if (p.alive && p.hp > 0) {
        Draw.rect(39, y + 4, (p.hp / p.maxHp) * 60, 8, GREEN());
      }
      drawText(106, y, WEAPONS[p.weapon].name, { color: YELLOW() });
      drawText(146, y, `LV${p.level}`, { color: WHITE() });
    }

    drawText(SCREEN_W - 84, 10, `WAVE ${w.wave}`, { color: GREEN() });
    const scoreStr = String(w.score).padStart(8, '0');
    drawText(SCREEN_W - 10 - textWidth(scoreStr), 30, scoreStr, { color: WHITE() });

    if (w.boss) {
      const ratio = w.boss.hpRatio();
      Draw.rect(SCREEN_W / 2 - 151, SCREEN_H - 26, 302, 12, Color.new(0, 0, 0, 80));
      Draw.rect(SCREEN_W / 2 - 150, SCREEN_H - 25, 300 * ratio, 10, RED());
    }

    this.renderBanner();

    if (w.paused) {
      Draw.rect(0, 0, SCREEN_W, SCREEN_H, Color.new(0, 0, 0, 70));
      drawTextCentered(SCREEN_W / 2, SCREEN_H / 2 - 20, 'PAUSED', { scale: 3, color: GREEN() });
    }
  }

  renderBanner() {
    const w = this.world;
    if (!w.banner || w.banner.t >= 3.2) return;
    const a = w.banner.t < 0.3 ? w.banner.t / 0.3 : w.banner.t > 2.2 ? Math.max(0, 1 - (w.banner.t - 2.2)) : 1;
    const c = w.banner.color;
    const faded = Color.new(Color.getR(c), Color.getG(c), Color.getB(c), Math.round(128 * a));
    drawTextCentered(SCREEN_W / 2, 86, w.banner.text, { scale: w.banner.scale, color: faded });
  }

  renderPerkOverlay() {
    const w = this.world;
    const p = w.perkOpen.player;
    Draw.rect(0, 0, SCREEN_W, SCREEN_H, Color.new(0, 0, 0, 90));
    drawTextCentered(SCREEN_W / 2, 96, `P${p.index + 1} LEVEL UP! CHOOSE A PERK`, { scale: 2, color: WHITE() });

    const cardW = 168;
    const cardH = 150;
    const gap = 24;
    const total = PERKS.length * cardW + (PERKS.length - 1) * gap;
    for (let i = 0; i < PERKS.length; i++) {
      const perk = PERKS[i];
      const x = SCREEN_W / 2 - total / 2 + i * (cardW + gap);
      const y = 170;
      const focused = i === w.perkOpen.idx;

      Draw.rect(x, y, cardW, cardH, Color.new(6, 40, 16, 115));
      const edge = focused ? GREEN() : Color.new(70, 110, 70, 128);
      const t = focused ? 3 : 1;
      Draw.rect(x, y, cardW, t, edge);
      Draw.rect(x, y + cardH - t, cardW, t, edge);
      Draw.rect(x, y, t, cardH, edge);
      Draw.rect(x + cardW - t, y, t, cardH, edge);

      P(perk.icon).center(x + cardW / 2, y + 44, { scale: 1.4 });
      drawTextCentered(x + cardW / 2, y + 88, perk.name, { color: focused ? GREEN() : WHITE() });
      drawTextCentered(x + cardW / 2, y + 116, perk.desc, { color: Color.new(180, 220, 180, 110) });
    }
    drawTextCentered(SCREEN_W / 2, 348, 'LEFT/RIGHT: SELECT   CROSS: CONFIRM', { color: Color.new(200, 200, 200, 100) });
  }
}
