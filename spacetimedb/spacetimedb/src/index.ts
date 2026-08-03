// Global Survival-mode leaderboard + auto-multiplayer relay for
// Sh'M↑ Party PS2.
//
// Leaderboard: one public `score` table, one anonymous reducer. The reducer
// trims the table to the top MAX_ROWS after every insert, so clients (the
// game's ps2/lib/leaderboard.js) read the whole table with one-off SQL and
// sort client-side — no ORDER BY needed.
//
// Point values are the game's per-kill scores, which come from Crimsonland's
// creature-variants.xml experience_worth (see ps2/data/tuning.js).
//
// Multiplayer (ps2/lib/net.js): one shared world, host-authoritative. The
// machine that starts a run claims seat 0 ("hosting"), simulates everything
// and streams compact world snapshots into the single `arena` row; up to
// three more machines claim seats 1-3 and relay their pad state through
// `seat` rows, which the host reads back and plays as extra players.
// Everyone else just reads `arena` and spectates.
//
// Clients are anonymous over the HTTP API, so a fresh identity arrives with
// every call and ctx.sender can't tie calls together. Seat ownership instead
// rides a client-generated random `key` — a per-seat bearer secret stored in
// the private seat_key table (public rows carry only the non-secret `tag`
// used for seat discovery). Fine for an arcade party game; nothing here
// guards anything more valuable than a pad slot.
//
// Liveness is heartbeat-based (no disconnect events over HTTP): inputs and
// snapshots refresh last_seen, and joins/snapshots evict seats quiet for
// longer than STALE. The host going quiet ends the game for everyone.

import { schema, table, t, SenderError } from 'spacetimedb/server';

const MAX_ROWS = 100;
// arcade initials: exactly 3 of A-Z / 0-9, same charset the entry screen offers
const NAME_RE = /^[A-Z0-9]{3}$/;
// generous sanity ceilings — reject obviously forged submissions
const SCORE_CAP = 100_000_000n;
const WAVE_CAP = 10_000;
const KILLS_CAP = 1_000_000;

const score = table(
  { name: 'score', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    score: t.u64(),
    wave: t.u32(),
    kills: t.u32(),
    players: t.u32(),
    at: t.timestamp(),
  }
);

// ── multiplayer tables ──────────────────────────────────────────────────────

const MAX_SEATS = 4;
// a seat whose owner hasn't been heard from in this long is abandoned
const STALE_MICROS = 6_000_000n;
// generous ceiling on a world snapshot (typ. 2-4 KB) — rejects runaway blobs
const SNAPSHOT_CAP = 60_000;

// one row per player slot. Public so titles can count active players and the
// host can read everyone's pad state; the auth secret lives in seat_key.
const seat = table(
  { name: 'seat', public: true },
  {
    seat: t.u32().primaryKey(),
    occupied: t.bool(),
    tag: t.string(), // non-secret client id: how a joiner finds its own seat
    lx: t.f32(),
    ly: t.f32(),
    rx: t.f32(),
    ry: t.f32(),
    buttons: t.u32(), // NETB bitmask (ps2/lib/net.js)
    lastSeen: t.timestamp(),
  }
);

// private (default): per-seat bearer secrets, only reducers can read
const seatKey = table(
  { name: 'seat_key' },
  {
    seat: t.u32().primaryKey(),
    key: t.string(),
  }
);

// the single shared world: host-published snapshot stream, id always 0
const arena = table(
  { name: 'arena', public: true },
  {
    id: t.u32().primaryKey(),
    seq: t.u64(), // bumps every publish; a frozen seq means a dead host
    over: t.bool(),
    wave: t.u32(),
    score: t.u64(),
    snapshot: t.string(), // compact JSON draw-state (ps2/screens/spectate.js)
    updatedAt: t.timestamp(),
  }
);

const spacetimedb = schema({ score, seat, seatKey, arena });
export default spacetimedb;

// ── multiplayer helpers ─────────────────────────────────────────────────────

function ensureSeats(ctx: any) {
  for (let i = 0; i < MAX_SEATS; i++) {
    if (!ctx.db.seat.seat.find(i)) {
      ctx.db.seat.insert({
        seat: i,
        occupied: false,
        tag: '',
        lx: 0,
        ly: 0,
        rx: 0,
        ry: 0,
        buttons: 0,
        lastSeen: ctx.timestamp,
      });
    }
  }
}

function releaseSeat(ctx: any, s: any) {
  ctx.db.seat.seat.update({
    ...s,
    occupied: false,
    tag: '',
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    buttons: 0,
  });
  if (ctx.db.seatKey.seat.find(s.seat)) ctx.db.seatKey.seat.delete(s.seat);
}

/** the game dies with its host: free every seat, flag the arena over */
function endGame(ctx: any) {
  for (const s of [...ctx.db.seat.iter()]) {
    if (s.occupied) releaseSeat(ctx, s);
  }
  const a = ctx.db.arena.id.find(0);
  if (a && !a.over) ctx.db.arena.id.update({ ...a, over: true, updatedAt: ctx.timestamp });
}

/** drop seats that stopped heartbeating; a stale host takes the game down */
function evictStale(ctx: any) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  let hostGone = false;
  for (const s of [...ctx.db.seat.iter()]) {
    if (!s.occupied) continue;
    if (now - s.lastSeen.microsSinceUnixEpoch <= STALE_MICROS) continue;
    releaseSeat(ctx, s);
    if (s.seat === 0) hostGone = true;
  }
  if (hostGone) endGame(ctx);
}

function authSeat(ctx: any, seatId: number, key: string) {
  const s = ctx.db.seat.seat.find(seatId);
  const k = ctx.db.seatKey.seat.find(seatId);
  if (!s || !s.occupied || !k || k.key !== key) throw new SenderError('bad seat');
  return s;
}

/** live game = arena exists, not over, and the host seat is occupied */
function gameLive(ctx: any) {
  const a = ctx.db.arena.id.find(0);
  if (!a || a.over) return false;
  const host = ctx.db.seat.seat.find(0);
  return !!(host && host.occupied);
}

export const submitScore = spacetimedb.reducer(
  {
    name: t.string(),
    score: t.u64(),
    wave: t.u32(),
    kills: t.u32(),
    players: t.u32(),
  },
  (ctx, { name, score: points, wave, kills, players }) => {
    const initials = name.toUpperCase();
    if (!NAME_RE.test(initials)) throw new SenderError('initials must be 3 chars of A-Z 0-9');
    if (points > SCORE_CAP) throw new SenderError('score out of range');
    if (wave > WAVE_CAP || kills > KILLS_CAP) throw new SenderError('stats out of range');
    if (players < 1 || players > 8) throw new SenderError('players out of range');

    ctx.db.score.insert({
      id: 0n,
      name: initials,
      score: points,
      wave,
      kills,
      players,
      at: ctx.timestamp,
    });

    // keep only the best MAX_ROWS; ties resolve to the earlier submission
    const rows = [...ctx.db.score.iter()].sort((a, b) => {
      if (a.score !== b.score) return a.score > b.score ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    for (const r of rows.slice(MAX_ROWS)) ctx.db.score.id.delete(r.id);
  }
);

// ── multiplayer reducers ────────────────────────────────────────────────────

/**
 * Claim a seat. hosting=true is "I'm starting a run": it tears down whatever
 * finished/stale game is lying around and takes seat 0 (refused while a live
 * host is publishing — the caller falls back to an offline local run).
 * hosting=false joins the live game in the lowest free seat: the host's
 * extra local pads and remote spectators pressing START both land here.
 * The caller finds which seat it got by reading the seat table back and
 * matching its tag.
 */
export const netJoin = spacetimedb.reducer(
  { key: t.string(), tag: t.string(), hosting: t.bool() },
  (ctx, { key, tag, hosting }) => {
    if (key.length < 8 || key.length > 64) throw new SenderError('bad key');
    if (tag.length < 4 || tag.length > 64) throw new SenderError('bad tag');
    ensureSeats(ctx);
    evictStale(ctx);

    if (hosting) {
      if (gameLive(ctx)) throw new SenderError('game in progress');
      // sweep leftovers of the previous run and open a fresh arena
      for (const s of [...ctx.db.seat.iter()]) {
        if (s.occupied) releaseSeat(ctx, s);
      }
      const fresh = {
        id: 0,
        seq: 0n,
        over: false,
        wave: 0,
        score: 0n,
        snapshot: '',
        updatedAt: ctx.timestamp,
      };
      if (ctx.db.arena.id.find(0)) ctx.db.arena.id.update(fresh);
      else ctx.db.arena.insert(fresh);
      claim(ctx, ctx.db.seat.seat.find(0), key, tag);
      return;
    }

    if (!gameLive(ctx)) throw new SenderError('no game');
    let free: any = null;
    for (const s of ctx.db.seat.iter()) {
      if (!s.occupied && (free === null || s.seat < free.seat)) free = s;
    }
    if (!free) throw new SenderError('full');
    claim(ctx, free, key, tag);
  }
);

function claim(ctx: any, s: any, key: string, tag: string) {
  ctx.db.seat.seat.update({
    ...s,
    occupied: true,
    tag,
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    buttons: 0,
    lastSeen: ctx.timestamp,
  });
  if (ctx.db.seatKey.seat.find(s.seat)) ctx.db.seatKey.seat.update({ seat: s.seat, key });
  else ctx.db.seatKey.insert({ seat: s.seat, key });
}

/** a remote player's pad state — doubles as their heartbeat */
export const netInput = spacetimedb.reducer(
  {
    seat: t.u32(),
    key: t.string(),
    lx: t.f32(),
    ly: t.f32(),
    rx: t.f32(),
    ry: t.f32(),
    buttons: t.u32(),
  },
  (ctx, a) => {
    const s = authSeat(ctx, a.seat, a.key);
    ctx.db.seat.seat.update({
      ...s,
      lx: a.lx,
      ly: a.ly,
      rx: a.rx,
      ry: a.ry,
      buttons: a.buttons,
      lastSeen: ctx.timestamp,
    });
  }
);

/** the host's world stream; over=true is the run's last word and frees
    every seat so the next PRESS START anywhere can host a new game */
export const netSnapshot = spacetimedb.reducer(
  {
    seat: t.u32(),
    key: t.string(),
    seq: t.u64(),
    wave: t.u32(),
    score: t.u64(),
    over: t.bool(),
    snapshot: t.string(),
  },
  (ctx, a) => {
    if (a.seat !== 0) throw new SenderError('not host');
    if (a.snapshot.length > SNAPSHOT_CAP) throw new SenderError('snapshot too big');
    const s = authSeat(ctx, a.seat, a.key);
    ctx.db.seat.seat.update({ ...s, lastSeen: ctx.timestamp });
    // the host's publish clock doubles as the eviction sweep while a game runs
    evictStale(ctx);
    const arenaRow = ctx.db.arena.id.find(0);
    if (!arenaRow) throw new SenderError('no arena');
    ctx.db.arena.id.update({
      ...arenaRow,
      seq: a.seq,
      wave: a.wave,
      score: a.score,
      over: a.over,
      snapshot: a.snapshot,
      updatedAt: ctx.timestamp,
    });
    if (a.over) endGame(ctx);
  }
);

/** give a seat back; the host leaving ends the game for everyone */
export const netLeave = spacetimedb.reducer(
  { seat: t.u32(), key: t.string() },
  (ctx, a) => {
    const s = authSeat(ctx, a.seat, a.key);
    if (a.seat === 0) endGame(ctx);
    else releaseSeat(ctx, s);
  }
);
