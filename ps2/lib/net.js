// Auto-multiplayer client over SpacetimeDB's HTTP API — the same anonymous
// transport (and database) as lib/leaderboard.js, so there are no new
// dependencies and no accounts. Browser-only: real PS2's synchronous Request
// would hitch the frame loop at these rates, so netAvailable() is false
// there and every host keeps today's offline local play.
//
// Shape of the thing (module: spacetimedb/spacetimedb/src/index.ts):
//   - the machine that starts a run "hosts": it claims seat 0, simulates the
//     whole world and publishes compact JSON snapshots into the arena row
//     (screens/game.js -> netTick)
//   - machines that join claim seats 1-3 and stream their pad state through
//     their seat row; the host plays them as extra players
//   - everyone else polls the arena row and spectates (screens/spectate.js)
//
// Seat ownership is a client-generated random bearer key (anonymous HTTP
// calls can't reuse an identity); the public seat row carries only a random
// tag, which is how a joiner discovers which seat it was given.
//
// Everything here is fire-and-forget and rate-limited: one request of each
// kind in flight, minimum intervals from data/tuning.js NET. A dead network
// reads as an empty lobby.

import { NET, ENEMIES, VARIANTS } from 'data/tuning.js';
import { post, parseSqlRows } from 'lib/leaderboard.js';

const hasFetch = typeof fetch === 'function';

export function netAvailable() {
  return hasFetch && NET.enabled;
}

// canonical enemy/variant orderings for compact snapshots — both ends run
// the same build, so Object.keys order matches
export const ENEMY_TYPES = Object.keys(ENEMIES);
export const VARIANT_KEYS = Object.keys(VARIANTS);

// pad buttons on the wire (Pads.* constants stay host-side; this mask is
// the cross-machine contract)
export const NETB = {
  CROSS: 1,
  CIRCLE: 2,
  SQUARE: 4,
  TRIANGLE: 8,
  L1: 16,
  R1: 32,
  L2: 64,
  R2: 128,
  START: 256,
  SELECT: 512,
  UP: 1024,
  DOWN: 2048,
  LEFT: 4096,
  RIGHT: 8192,
};

// built lazily so this module can load before the Pads global exists
let PAIRS = null;
function pairs() {
  if (!PAIRS) {
    PAIRS = [
      [Pads.CROSS, NETB.CROSS],
      [Pads.CIRCLE, NETB.CIRCLE],
      [Pads.SQUARE, NETB.SQUARE],
      [Pads.TRIANGLE, NETB.TRIANGLE],
      [Pads.L1, NETB.L1],
      [Pads.R1, NETB.R1],
      [Pads.L2, NETB.L2],
      [Pads.R2, NETB.R2],
      [Pads.START, NETB.START],
      [Pads.SELECT, NETB.SELECT],
      [Pads.UP, NETB.UP],
      [Pads.DOWN, NETB.DOWN],
      [Pads.LEFT, NETB.LEFT],
      [Pads.RIGHT, NETB.RIGHT],
    ];
  }
  return PAIRS;
}

/** Pads.* mask -> NETB mask */
export function netBits(padsMask) {
  let b = 0;
  for (const [pm, nb] of pairs()) {
    if (padsMask & pm) b |= nb;
  }
  return b;
}

/** NETB mask of everything a polled pad currently holds */
export function heldButtons(pad) {
  let b = 0;
  for (const [pm, nb] of pairs()) {
    if (pad.held(pm)) b |= nb;
  }
  return b;
}

/** NETB mask of this frame's fresh presses (latch these between sends so a
    tap between two 90ms posts isn't lost) */
export function justButtons(pad) {
  let b = 0;
  for (const [pm, nb] of pairs()) {
    if (pad.just(pm)) b |= nb;
  }
  return b;
}

// ── polled state ────────────────────────────────────────────────────────────

/** last successful reads, shared by every screen */
export const net = {
  seats: null, // [{seat, occupied, tag, lx, ly, rx, ry, buttons}] sorted
  arena: null, // {seq, over, wave, score, snapshot} (snapshot = JSON string)
  seq: -1,
  seqChangedAt: 0, // Date.now() when seq last advanced — staleness clock
};

const lastAt = { seats: 0, arena: 0, input: 0, snap: 0 };
const inFlight = { seats: false, arena: false, input: false, snap: false };

function normalizeSeat(row) {
  return {
    seat: Number(row.seat),
    occupied: !!row.occupied,
    tag: typeof row.tag === 'string' ? row.tag : '',
    lx: Number(row.lx) || 0,
    ly: Number(row.ly) || 0,
    rx: Number(row.rx) || 0,
    ry: Number(row.ry) || 0,
    buttons: Number(row.buttons) || 0,
  };
}

function storeSeats(rows) {
  if (!rows) return;
  net.seats = rows.map(normalizeSeat).sort((a, b) => a.seat - b.seat);
}

/** refresh net.seats, at most once per minMs; screens call this every frame */
export function pollSeats(minMs) {
  if (!netAvailable() || inFlight.seats || Date.now() - lastAt.seats < minMs) return;
  inFlight.seats = true;
  lastAt.seats = Date.now();
  post('sql', 'SELECT * FROM seat', 'text/plain', (text) => {
    inFlight.seats = false;
    storeSeats(parseSqlRows(text));
  });
}

/** refresh net.arena, at most once per minMs; tracks seq movement locally so
    a frozen stream (crashed host) is detectable without trusting clocks */
export function pollArena(minMs) {
  if (!netAvailable() || inFlight.arena || Date.now() - lastAt.arena < minMs) return;
  inFlight.arena = true;
  lastAt.arena = Date.now();
  post('sql', 'SELECT * FROM arena', 'text/plain', (text) => {
    inFlight.arena = false;
    const rows = parseSqlRows(text);
    if (!rows || rows.length === 0) return;
    const row = rows[0];
    const seq = Number(row.seq) || 0;
    if (seq !== net.seq) {
      net.seq = seq;
      net.seqChangedAt = Date.now();
    }
    net.arena = {
      seq,
      over: !!row.over,
      wave: Number(row.wave) || 0,
      score: Number(row.score) || 0,
      snapshot: typeof row.snapshot === 'string' ? row.snapshot : '',
    };
  });
}

export function activeSeats() {
  if (!net.seats) return 0;
  let n = 0;
  for (const s of net.seats) if (s.occupied) n++;
  return n;
}

export function seatsFull() {
  return activeSeats() >= NET.seats;
}

/** a run someone can spectate/join right now: host seat occupied, arena not
    over, and its snapshot stream moved within NET.staleMs */
export function gameLive() {
  if (!net.arena || net.arena.over) return false;
  if (!net.seats || !net.seats.some((s) => s.seat === 0 && s.occupied)) return false;
  return net.seq > 0 && Date.now() - net.seqChangedAt < NET.staleMs;
}

// ── reducer calls ───────────────────────────────────────────────────────────

function randHex(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += ((Math.random() * 16) | 0).toString(16);
  return out;
}

/**
 * Claim a seat (hosting=true: tear down stale games and take seat 0;
 * false: lowest free seat of the live game). cb(seat|null, key) — the seat
 * is discovered by reading the table back and matching our tag. Returns the
 * tag immediately (null offline) so a host can recognize its own in-flight
 * claims in seat polls and not mistake them for remote joiners.
 */
export function join(hosting, cb) {
  if (!netAvailable()) {
    cb(null, null);
    return null;
  }
  const key = randHex(24);
  const tag = randHex(12);
  post('call/net_join', JSON.stringify([key, tag, hosting]), 'application/json', (res) => {
    if (res === null) return void cb(null, null);
    post('sql', 'SELECT * FROM seat', 'text/plain', (text) => {
      const rows = parseSqlRows(text);
      storeSeats(rows);
      const mine = net.seats && net.seats.find((s) => s.tag === tag);
      cb(mine ? mine.seat : null, key);
    });
  });
  return tag;
}

/** relay this machine's pad state (rate-limited); returns true when a send
    actually went out, so the caller knows to clear its press latch */
export function sendInput(seat, key, lx, ly, rx, ry, buttons) {
  if (!netAvailable() || inFlight.input || Date.now() - lastAt.input < NET.inputMs) return false;
  inFlight.input = true;
  lastAt.input = Date.now();
  post(
    'call/net_input',
    JSON.stringify([seat, key, round2(lx), round2(ly), round2(rx), round2(ry), buttons]),
    'application/json',
    () => {
      inFlight.input = false;
    },
  );
  return true;
}

/** true when the snapshot rate limiter would let a publish through — checked
    before spending time serializing the world */
export function canPublish() {
  return netAvailable() && !inFlight.snap && Date.now() - lastAt.snap >= NET.snapMs;
}

export function publish(seat, key, seq, wave, score, over, snapshotStr) {
  if (!canPublish()) return false;
  inFlight.snap = true;
  lastAt.snap = Date.now();
  post(
    'call/net_snapshot',
    JSON.stringify([seat, key, seq, wave, score, over, snapshotStr]),
    'application/json',
    () => {
      inFlight.snap = false;
    },
  );
  return true;
}

export function leave(seat, key) {
  if (!netAvailable() || seat === null || !key) return;
  post('call/net_leave', JSON.stringify([seat, key]), 'application/json', () => {});
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
