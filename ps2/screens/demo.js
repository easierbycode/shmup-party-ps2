// Attract mode: the title idles into the Crimsonland demo reel
// (data/demos.js, generated from the Android rip's demos.xml) and plays its
// nodes in order — scripted troopers at scripted spots with scripted weapons,
// each node's spawn set pouring in for its scripted duration. The troopers
// drive themselves the way shmup-party-phaser4's attract bot does: wander,
// chase powerups, hose down the nearest enemy. Nobody can die out here.
//
// A human can grab Player 2 at any time with L1+R1 (phaser4's attract-join
// chord) and play inside the rolling reel; START — or CROSS on a spectating
// pad — bails back to the title. With no human aboard the reel returns to
// the title by itself after a full lap.

import GameScreen, { makePlayer } from 'screens/game.js';
import { DEMOS } from 'data/demos.js';
import { DEMO, ENEMIES, VARIANTS, WEAPONS, PERKS, PLAYER, POWERUPS } from 'data/tuning.js';
import { screens } from 'lib/screens.js';
import { sfx, tickAudio } from 'lib/audio.js';
import { buzz, updateHaptics } from 'lib/haptics.js';
import { pollPad, connectedPorts } from 'lib/input.js';
import { spawnEnemy, spawnDens, updateEnemies, nearestEnemy } from 'lib/enemies.js';
import { Boss } from 'lib/boss.js';
import { fx, updateFx } from 'lib/fx.js';
import { drawTextCentered } from 'lib/text.js';
import { SCREEN_W, SCREEN_H, rand, randInt, pick, clamp } from 'lib/util.js';

const GREEN = () => Color.new(156, 255, 107, 128);
const DIM = (a) => Color.new(190, 220, 190, a);
const AMBER = () => Color.new(255, 214, 120, 120);

// demos.xml spawn set -> this port's roster. `edge` pins the walk-in side
// (1 = bottom), `rate` scales the trickle, `ring`/`dens`/`boss` are staged
// once when the node opens.
const SPAWN_PLANS = {
  ALIENS: { types: ['alien'] },
  ALIENS_AROUND: { types: ['alien', 'blue-alien'], rate: 0.7 },
  LIZARDS: { types: ['lizard', 'blue-lizard', 'yellow-lizard'], rate: 0.6 },
  ZOMBIES: { types: ['zombie'] },
  ZOMBIES_RANDOM: { types: ['zombie', 'red-zombie'] },
  ZOMBIES_BELOW: { types: ['zombie', 'red-zombie'], edge: 1 },
  DENS: { types: [], dens: true },
  BOSS: { types: [], boss: true },
  SURROUNDED: { types: ['zombie', 'alien', 'spider', 'beetle', 'crabfly'], ring: true },
};

export default class DemoScreen extends GameScreen {
  onEnter() {
    this.makeWorld();
    const w = this.world;
    // demo bosses just pop and the reel rolls on — no wave bookkeeping
    w.onBossDefeated = () => {
      w.boss = null;
      w.flashT = 0.5;
      fx(w, 'eye-explode', SCREEN_W / 2, 120, { fps: 12, scale: 3 });
    };
    this.t = 0;
    this.humanPort = null;
    this.humanPlayer = null;
    this.joinGraceT = 0;
    this.nodeIdx = 0;
    this.setupNode(DEMOS[0]);
  }

  setupNode(node) {
    const w = this.world;
    this.node = node;
    this.nodeT = node.duration;
    this.plan = node.spawns ? SPAWN_PLANS[node.spawns] : null;
    this.trickleT = 0.4;
    this.powerupT = DEMO.powerupEvery;
    this.bossT = 0;
    w.enemies = [];
    w.bullets = [];
    w.enemyBullets = [];
    w.powerups = [];
    w.effects = [];
    w.nukes = [];
    w.boss = null;
    w.freezeT = 0;
    w.flashT = 0;
    w.perkQueue = [];
    w.perkOpen = null;

    // scripted troopers (a lone mid-arena wanderer when the node names none —
    // MENU_COMBAT_3 is just a horde ambling over the terrain in the original)
    const specs = node.troopers.length > 0
      ? node.troopers
      : [{ x: SCREEN_W / 2, y: SCREEN_H / 2, weapon: randInt(0, WEAPONS.length - 1) }];
    w.players = specs.map((spec, i) => {
      const p = makePlayer(-1, i);
      p.ai = true;
      p.x = spec.x;
      p.y = spec.y;
      p.weapon = spec.weapon || 0;
      p.aiT = 0;
      p.mx = 0;
      p.my = 0;
      return p;
    });
    if (this.humanPort !== null) this.seatHuman();

    if (this.plan && this.plan.dens) spawnDens(w, 8); // two lizard dens + a nest
    if (this.plan && this.plan.boss) this.bossT = 0.8;
    if (this.plan && this.plan.ring) {
      const c = w.players[0];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const desc = this.demoDesc(pick(this.plan.types));
        desc.x = clamp(c.x + Math.cos(a) * 175, -20, SCREEN_W + 20);
        desc.y = clamp(c.y + Math.sin(a) * 175, -20, SCREEN_H + 20);
        spawnEnemy(w, desc);
      }
    }
  }

  /** put the joined human in the Player 2 slot, replacing that node's AI
      trooper (or conjuring the slot when the script only staged one) */
  seatHuman() {
    const w = this.world;
    let p = this.humanPlayer;
    if (!p) {
      p = makePlayer(this.humanPort, 1);
      this.humanPlayer = p;
    }
    const spot = w.players[1] || w.players[0];
    p.x = clamp(spot.x + (w.players[1] ? 0 : 80), 40, SCREEN_W - 40);
    p.y = spot.y;
    if (w.players[1]) w.players[1] = p;
    else w.players.push(p);
  }

  tryJoin(port) {
    if (this.humanPort !== null) return;
    this.humanPort = port;
    this.seatHuman();
    // swallow the chord's own press edges — without this the joining L1
    // reads as a dash command and flings the brand-new Player 2 offscreen
    this.joinGraceT = 2 / 60;
    sfx('button_press');
    buzz(port, 'join');
    this.banner('PLAYER 2 JOINED', GREEN());
  }

  /** attract mode has no stakes: a hit shoves and blinks, never wounds */
  hurtPlayer(p, fromX, fromY) {
    const ang = Math.atan2(p.y - fromY, p.x - fromX);
    p.kbx = Math.cos(ang) * PLAYER.knockback;
    p.kby = Math.sin(ang) * PLAYER.knockback;
    p.invulnT = PLAYER.invulnAfterHit;
    if (!p.ai) buzz(p.port, 'hurt');
  }

  padFor(p) {
    return p.ai ? p.aiPad : pollPad(p.port);
  }

  /** the phaser4 attract bot, poured into a synthetic pad: wander impulses,
      powerup chasing, auto-aim on the nearest enemy, an occasional dash */
  driveAI(p, dt) {
    const w = this.world;
    p.aiT -= dt;
    if (p.aiT <= 0) {
      p.aiT = rand(0.25, 0.6);
      let goal = null;
      let best = 200 * 200; // only bother with gifts reasonably nearby
      for (const pu of w.powerups) {
        const dx = pu.x - p.x;
        const dy = pu.y - p.y;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          goal = pu;
        }
      }
      if (goal) {
        const a = Math.atan2(goal.y - p.y, goal.x - p.x);
        p.mx = Math.cos(a);
        p.my = Math.sin(a);
      } else if (Math.random() < 0.55) {
        p.mx = rand(-1, 1);
        p.my = rand(-1, 1);
      } else {
        p.mx = 0;
        p.my = 0;
      }
      p.sweepFire = Math.random() < 0.3;
    }
    // shy away from the walls so a wander impulse can't pin them there
    if (p.x < 80) p.mx = Math.abs(p.mx) || 0.7;
    else if (p.x > SCREEN_W - 80) p.mx = -(Math.abs(p.mx) || 0.7);
    if (p.y < 70) p.my = Math.abs(p.my) || 0.7;
    else if (p.y > SCREEN_H - 70) p.my = -(Math.abs(p.my) || 0.7);

    const target = nearestEnemy(w, p.x, p.y);
    let rx = 0;
    let ry = 0;
    let dash = false;
    if (target) {
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const a = Math.atan2(dy, dx);
      rx = Math.cos(a);
      ry = Math.sin(a);
      dash = dx * dx + dy * dy < 90 * 90 && Math.random() < 0.02;
    } else {
      // nothing to shoot: sweep the barrel around, squeezing off the odd burst
      p.heading += dt * 1.5;
      if (p.sweepFire) {
        rx = Math.cos(p.heading);
        ry = Math.sin(p.heading);
      }
    }
    p.aiPad = {
      held: () => false,
      just: (mask) => dash && mask === Pads.L1,
      lx: p.mx,
      ly: p.my,
      rx,
      ry,
    };
  }

  demoDesc(key) {
    const v = VARIANTS[key];
    const type = v ? v.base : key;
    const stats = v || ENEMIES[type];
    return { type, variant: v ? key : undefined, hp: stats.hp, speed: stats.speed };
  }

  updateDemoSpawns(dt) {
    const w = this.world;
    if (this.bossT > 0) {
      this.bossT -= dt;
      if (this.bossT <= 0) w.boss = new Boss(w);
    }
    if (this.node.powerups) {
      this.powerupT -= dt;
      if (this.powerupT <= 0) {
        this.powerupT = DEMO.powerupEvery;
        w.powerups.push({
          type: pick(POWERUPS.types),
          x: rand(60, SCREEN_W - 60),
          y: rand(60, SCREEN_H - 60),
          t: 0,
        });
      }
    }
    if (!this.plan || this.plan.types.length === 0) return;
    this.trickleT -= dt;
    if (this.trickleT <= 0 && w.enemies.length < DEMO.maxAlive) {
      this.trickleT = DEMO.trickle * (this.plan.rate || 1);
      const desc = this.demoDesc(pick(this.plan.types));
      if (this.plan.edge !== undefined) desc.edge = this.plan.edge;
      spawnEnemy(w, desc);
    }
  }

  update(dt) {
    const w = this.world;
    updateHaptics(dt);
    tickAudio(dt);
    this.t += dt;

    for (const port of connectedPorts()) {
      const pad = pollPad(port);
      const spectating = port !== this.humanPort;
      if (spectating && pad.held(Pads.L1) && pad.held(Pads.R1)
          && (pad.just(Pads.L1) || pad.just(Pads.R1))) {
        this.tryJoin(port);
        continue;
      }
      if (pad.just(Pads.START) || (spectating && pad.just(Pads.CROSS))) {
        sfx('button_press');
        screens.change('title');
        return;
      }
    }

    // the human's level-ups open the real perk picker (and hold the reel);
    // AI troopers grab a random perk like phaser4's demo bot
    if (w.perkOpen) {
      this.updatePerkOverlay();
      return;
    }
    while (w.perkQueue.length > 0) {
      const p = w.perkQueue.shift();
      if (p.ai) this.applyPerk(p, pick(PERKS));
      else {
        w.perkOpen = { player: p, idx: 1 };
        return;
      }
    }

    if (w.banner) {
      w.banner.t += dt;
      if (w.banner.t > 3.2) w.banner = null;
    }
    if (w.flashT > 0) w.flashT -= dt;
    if (w.freezeT > 0) w.freezeT -= dt;

    this.updateDemoSpawns(dt);
    for (const p of w.players) {
      if (p.ai) this.driveAI(p, dt);
      else if (this.joinGraceT > 0) {
        this.joinGraceT -= dt;
        continue;
      }
      this.updatePlayer(p, dt);
    }
    updateEnemies(w, dt);
    if (w.boss) w.boss.update(dt);
    this.updateBullets(dt);
    this.updateEnemyBullets(dt);
    this.updatePowerups(dt);
    this.updateNukes(dt);
    updateFx(w, dt);

    this.nodeT -= dt;
    if (this.nodeT <= 0) {
      const next = (this.nodeIdx + 1) % DEMOS.length;
      if (next === 0 && this.humanPort === null) {
        screens.change('title');
        return;
      }
      this.nodeIdx = next;
      this.setupNode(DEMOS[next]);
    }
  }

  render() {
    this.renderWorld();
    this.renderBanner();

    if (Math.floor(this.t * 2) % 2 === 0) {
      drawTextCentered(SCREEN_W / 2, 16, 'DEMO', { scale: 2, color: DIM(100) });
    }
    if (this.node.text) {
      drawTextCentered(SCREEN_W / 2, SCREEN_H - 74, this.node.text.toUpperCase(), { color: AMBER() });
    }
    if (this.humanPort === null) {
      drawTextCentered(SCREEN_W / 2, SCREEN_H - 48, 'L1+R1: JOIN AS PLAYER 2', { color: GREEN() });
    }
    drawTextCentered(SCREEN_W / 2, SCREEN_H - 26, 'PRESS START', { color: DIM(90) });

    if (this.world.perkOpen) this.renderPerkOverlay();
  }
}
