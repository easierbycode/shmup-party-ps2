// Spectator / remote-player screen for auto multiplayer (lib/net.js).
//
// The title drops in here whenever another machine is hosting a live run.
// This screen never simulates the game: it decodes the host's ~8Hz JSON
// snapshots into a mirror world shaped exactly like GameScreen's, then
// renders it with the inherited renderWorld/renderHud. Between snapshots
// the mirror keeps breathing — positions ease toward their latest targets,
// animation clocks and projectiles advance locally — so the stream reads
// as 60fps with 8Hz corrections.
//
// PRESS START claims a free seat (max 4 players; overflow keeps watching):
// from then on this machine relays its pad through the seat row and the
// host plays it as a live player — you watch yourself through the stream.
// TRIANGLE backs out to the title (leaving the seat if one was claimed).
// The run ending — or the host going quiet for NET.staleMs — sends
// everyone home.

import GameScreen from 'screens/game.js';
import { PLAYER, WEAPONS, VARIANTS, POWERUPS, NET } from 'data/tuning.js';
import { screens } from 'lib/screens.js';
import { sfx, tickAudio } from 'lib/audio.js';
import { pollPad, connectedPorts } from 'lib/input.js';
import { P } from 'lib/sprites.js';
import { Boss } from 'lib/boss.js';
import { updateFx } from 'lib/fx.js';
import { updateCamera } from 'lib/camera.js';
import { drawTextCentered } from 'lib/text.js';
import { SCREEN_W, SCREEN_H, clamp } from 'lib/util.js';
import * as netlib from 'lib/net.js';

const GREEN = () => Color.new(156, 255, 107, 128);
const RED = () => Color.new(255, 64, 64, 128);
const DIM = (a) => Color.new(190, 220, 190, a);
const AMBER = () => Color.new(255, 214, 120, 120);

// how hard mirrored positions chase their snapshot targets (per second);
// ~70% of the remaining error closes between two 125ms snapshots
const LERP_RATE = 10;

export default class SpectateScreen extends GameScreen {
  onEnter(opts) {
    this.makeWorld();
    this.world.players = [];
    this.t = 0;
    this.mode = 'watch'; // 'watch' | 'play'
    this.mySeat = null;
    this.myKey = null;
    this.myPort = 0;
    this.joining = false;
    this.latch = 0; // NETB press bits waiting for the next input send
    this.message = null;
    this.messageT = 0;
    this.appliedSeq = -1;
    this.haveWorld = false;
    this.noSignalT = 0;
    this.endT = 0;
    if (opts && opts.autoJoin) this.tryJoin(opts.port === undefined ? 0 : opts.port);
  }

  onExit() {
    // GameScreen.onExit would try to tear down a host session; a spectator
    // only has its (maybe) claimed seat to give back
    if (this.mySeat !== null) netlib.leave(this.mySeat, this.myKey);
  }

  tryJoin(port) {
    if (this.joining || this.mySeat !== null) return;
    if (netlib.seatsFull()) {
      this.say('GAME FULL - SPECTATING');
      return;
    }
    this.joining = true;
    this.myPort = port;
    netlib.join(false, (seat, key) => {
      this.joining = false;
      if (seat === null) {
        this.say('GAME FULL - SPECTATING');
        return;
      }
      sfx('button_press');
      this.mySeat = seat;
      this.myKey = key;
      this.latch = 0;
      this.mode = 'play';
      this.say(`YOU ARE PLAYER ${seat + 1}`);
    });
  }

  say(text) {
    this.message = text;
    this.messageT = 3;
  }

  update(dt) {
    const w = this.world;
    this.t += dt;
    tickAudio(dt);
    if (this.messageT > 0) this.messageT -= dt;

    // the run is over (or the host vanished): let the banner land, go home
    if (this.endT > 0) {
      this.endT -= dt;
      this.advanceMirror(dt);
      if (this.endT <= 0) screens.change('title');
      return;
    }

    netlib.pollArena(NET.pollMs);
    netlib.pollSeats(NET.pollMs * 4);

    const arena = netlib.net.arena;
    if (arena && arena.seq !== this.appliedSeq && arena.snapshot) {
      this.appliedSeq = arena.seq;
      this.applySnapshot(arena.snapshot);
    }

    // dead-stream detection: over flag, our host seat emptied, or a stream
    // that never starts / stops moving
    const seats = netlib.net.seats;
    const hostGone = seats && !seats.some((s) => s.seat === 0 && s.occupied);
    const stale = this.haveWorld
      ? Date.now() - netlib.net.seqChangedAt > NET.staleMs
      : (this.noSignalT += dt) > NET.staleMs / 1000 + 2;
    if ((arena && arena.over) || hostGone || stale) {
      this.beginEnd((arena && arena.over) || hostGone ? 'GAME OVER' : 'LOST SIGNAL');
      return;
    }

    // our seat can evaporate under us (host restarted, heartbeat hiccup)
    if (this.mode === 'play' && seats) {
      const mine = seats.find((s) => s.seat === this.mySeat);
      if (mine && !mine.occupied) {
        this.mode = 'watch';
        this.mySeat = null;
        this.myKey = null;
        this.say('SEAT LOST - SPECTATING');
      }
    }

    // pads: join/leave while watching, relay while playing
    for (const port of connectedPorts()) {
      const pad = pollPad(port);
      if (this.mode === 'play' && port === this.myPort) {
        this.latch |= netlib.justButtons(pad);
        const buttons = netlib.heldButtons(pad) | this.latch;
        if (netlib.sendInput(this.mySeat, this.myKey, pad.lx, pad.ly, pad.rx, pad.ry, buttons)) {
          this.latch = 0;
        }
        if (pad.just(Pads.TRIANGLE)) {
          sfx('button_press');
          screens.change('title');
          return;
        }
        continue;
      }
      if (pad.just(Pads.START)) this.tryJoin(port);
      if (pad.just(Pads.TRIANGLE)) {
        sfx('button_press');
        screens.change('title');
        return;
      }
    }

    if (this.haveWorld) this.advanceMirror(dt);
  }

  beginEnd(text) {
    this.endT = 2.5;
    this.world.banner = { text, color: RED(), t: 0, scale: 4 };
    if (this.mySeat !== null) {
      netlib.leave(this.mySeat, this.myKey);
      this.mySeat = null;
      this.myKey = null;
    }
  }

  /** decode one host snapshot into the mirror world. Entities with stable
      ids (players by seat order, enemies by id) keep their local positions
      and get new targets; the cheap short-lived stuff is replaced wholesale. */
  applySnapshot(json) {
    let s;
    try {
      s = JSON.parse(json);
    } catch (_) {
      return;
    }
    const w = this.world;
    const firstWorld = !this.haveWorld;
    this.haveWorld = true;

    this.terrain = {
      idx: s.tr[0],
      pic: `terrain-survival-${s.tr[0]}`,
      flipX: !!s.tr[1],
      flipY: !!s.tr[2],
    };
    w.wave = s.wv;
    w.score = s.sc;
    w.freezeT = s.fz;
    w.slowT = s.sl;
    w.flashT = s.fl;
    w.paused = !!s.pa;
    w.banner = s.bn
      ? { text: s.bn[0], color: Color.new(s.bn[1], s.bn[2], s.bn[3], 128), scale: s.bn[4], t: s.bn[5] }
      : null;

    // players: matched positionally by seat id (seat -1 entries — pads on
    // the host machine that haven't claimed a seat yet — match by index)
    const oldPlayers = w.players;
    w.players = s.pl.map((row, i) => {
      const [seat, skinIdx, x, y, heading, alive, invulnT, dashT, dashDir, giantT, chompT, chompAng, hp, maxHp, weapon, level] = row;
      let p = oldPlayers.find((q) => (seat >= 0 ? q.seat === seat : q.index === i && q.seat < 0));
      if (!p) p = { port: -1, x, y, animT: Math.random() };
      p.seat = seat;
      p.index = i;
      p.skin = PLAYER.skins[skinIdx] || PLAYER.skins[0];
      p.tx = x;
      p.ty = y;
      p.heading = heading;
      p.alive = !!alive;
      p.invulnT = invulnT;
      p.dashT = dashT;
      p.dashDir = dashDir;
      p.giantT = giantT;
      p.chompT = chompT;
      p.chompAng = chompAng;
      p.hp = hp;
      p.maxHp = maxHp;
      p.weapon = weapon;
      p.level = level;
      if (firstWorld) {
        p.x = x;
        p.y = y;
      }
      return p;
    });

    // enemies by id
    const oldEnemies = new Map();
    for (const e of w.enemies) oldEnemies.set(e.id, e);
    w.enemies = s.en.map((row) => {
      const [id, ti, vi, x, y, facingLeft] = row;
      let e = oldEnemies.get(id);
      if (!e) {
        const type = netlib.ENEMY_TYPES[ti];
        const variant = vi >= 0 ? netlib.VARIANT_KEYS[vi] : undefined;
        const v = variant ? VARIANTS[variant] : null;
        e = {
          id,
          type,
          x,
          y,
          scale: v ? v.scale : undefined,
          tint: v ? Color.new(v.tint[0], v.tint[1], v.tint[2], v.alpha === undefined ? 128 : v.alpha) : undefined,
          animT: (id * 0.137) % 1,
        };
      }
      e.tx = x;
      e.ty = y;
      e.facingLeft = !!facingLeft;
      return e;
    });

    // projectiles/pickups/effects: replaced whole; they keep moving locally
    // between snapshots so the swap is invisible
    w.bullets = s.bu.map((row) => {
      const [wi, x, y, heading, t] = row;
      const spec = wi >= 0 ? WEAPONS[wi] : { sheet: 'bullet', fps: 12, radius: 8 };
      const speed = wi >= 0 ? spec.speed : POWERUPS.fireblastSpeed;
      return { spec, x, y, heading, t, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed };
    });
    w.enemyBullets = s.eb.map(([x, y, vx, vy, t]) => ({ x, y, vx, vy, t }));
    w.powerups = s.pu.map(([ti, x, y, t]) => ({ type: POWERUPS.types[ti], x, y, t }));
    w.effects = s.fxs.map(([sheet, x, y, t, fps, scale, flipX]) => ({ sheet, x, y, t, fps, scale, flipX: !!flipX }));
    w.nukes = s.nk.map(([x, y, t]) => ({ x, y, t }));

    if (s.bo) {
      if (!w.boss) {
        w.boss = new Boss(w);
        // the mirror never simulates the boss; the bar rides the streamed hp
        w.boss.hpRatio = () => this.bossHp;
      }
      const [dying, prefireT, hp100, e0a, e0b, e1a, e1b] = s.bo;
      this.bossHp = hp100 / 100;
      w.boss.dying = dying;
      w.boss.prefire = prefireT >= 0 ? { t: prefireT } : null;
      w.boss.eyes[0].alive = !!e0a;
      w.boss.eyes[0].blinkT = e0b;
      w.boss.eyes[1].alive = !!e1a;
      w.boss.eyes[1].blinkT = e1b;
    } else {
      w.boss = null;
    }

    if (firstWorld) updateCamera(w.cam, w.players.filter((p) => p.alive), 0, true);
  }

  /** one 60fps frame of life between snapshots */
  advanceMirror(dt) {
    const w = this.world;
    const k = clamp(1 - Math.exp(-LERP_RATE * dt), 0, 1);
    const edt = w.slowT > 0 ? dt * POWERUPS.reflexScale : dt;

    for (const p of w.players) {
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      p.animT += dt;
      if (p.invulnT > 0) p.invulnT -= dt;
      if (p.dashT > 0) p.dashT -= dt;
      if (p.giantT > 0) p.giantT -= dt;
      if (p.chompT > 0) {
        p.chompT -= dt;
        p.chompAng += POWERUPS.chompSpin * dt;
      }
    }
    for (const e of w.enemies) {
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
      if (w.freezeT <= 0) e.animT += edt;
    }
    for (const b of w.bullets) {
      b.t += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    for (const b of w.enemyBullets) {
      b.t += edt;
      b.x += b.vx * edt;
      b.y += b.vy * edt;
    }
    for (const u of w.powerups) u.t += dt;
    for (let i = w.nukes.length - 1; i >= 0; i--) {
      w.nukes[i].t += dt;
      if (w.nukes[i].t >= POWERUPS.nukeTime) w.nukes.splice(i, 1);
    }
    updateFx(w, dt);
    if (w.freezeT > 0) w.freezeT -= dt;
    if (w.slowT > 0) w.slowT -= dt;
    if (w.flashT > 0) w.flashT -= dt;
    if (w.banner) w.banner.t += dt;
    if (w.boss) {
      w.boss.animT += dt;
      if (w.boss.prefire) w.boss.prefire.t += dt;
      for (const eye of w.boss.eyes) if (eye.blinkT > 0) eye.blinkT -= dt;
    }
    updateCamera(w.cam, w.players.filter((p) => p.alive), dt);
  }

  render() {
    if (!this.haveWorld) {
      P('bg').draw(0, 0, { color: Color.new(120, 120, 120, 128) });
      Draw.rect(0, 0, SCREEN_W, SCREEN_H, Color.new(0, 0, 0, 55));
      if (Math.floor(this.t * 2) % 2 === 0) {
        drawTextCentered(SCREEN_W / 2, SCREEN_H / 2 - 10, 'FINDING GAME...', { scale: 2, color: GREEN() });
      }
      drawTextCentered(SCREEN_W / 2, SCREEN_H - 30, 'TRIANGLE: BACK', { color: DIM(80) });
      return;
    }

    this.renderWorld();
    this.renderHud();
    this.renderYouMarker();

    // status strip
    if (this.endT <= 0) {
      if (this.mode === 'watch') {
        if (Math.floor(this.t * 2) % 2 === 0) {
          drawTextCentered(SCREEN_W / 2, 16, 'SPECTATING', { scale: 2, color: DIM(100) });
        }
        const label = this.joining
          ? 'JOINING...'
          : netlib.seatsFull()
            ? 'GAME FULL - A FREE SEAT LETS YOU IN'
            : 'PRESS START TO JOIN';
        drawTextCentered(SCREEN_W / 2, SCREEN_H - 48, label, { color: GREEN() });
        drawTextCentered(SCREEN_W / 2, SCREEN_H - 26, 'TRIANGLE: BACK', { color: DIM(90) });
      } else {
        drawTextCentered(SCREEN_W / 2, SCREEN_H - 26, 'TRIANGLE: LEAVE GAME', { color: DIM(70) });
      }
    }
    if (this.message && this.messageT > 0) {
      drawTextCentered(SCREEN_W / 2, SCREEN_H - 74, this.message, { scale: 2, color: AMBER() });
    }
  }

  /** a marker over the player this machine controls — you're watching
      yourself through the host's stream, so make yourself easy to find */
  renderYouMarker() {
    if (this.mySeat === null) return;
    const w = this.world;
    const p = w.players.find((q) => q.seat === this.mySeat);
    if (!p || !p.alive) return;
    const sx = (p.x - w.cam.x) * w.cam.zoom + SCREEN_W / 2;
    const sy = (p.y - w.cam.y) * w.cam.zoom + SCREEN_H / 2;
    const bob = Math.sin(this.t * 6) * 3;
    drawTextCentered(sx, sy - 34 * w.cam.zoom - 12 + bob, `P${p.index + 1} YOU`, { color: GREEN() });
  }
}
