// Global Survival leaderboard over SpacetimeDB's HTTP API — one client for
// both targets. Writes go through the module's submit_score reducer
// (POST /v1/database/:db/call/submit_score, anonymous), reads through one-off
// SQL over the public score table (POST /v1/database/:db/sql). The module
// keeps the table trimmed to its top 100, so a read is just SELECT * and a
// client-side sort — no ORDER BY needed.
//
// Transports, picked once at load:
//   - browser: fetch (async; callbacks fire on a later frame)
//   - real PS2: AthenaEnv's Network + Request (TLS 1.2 capable; post() is
//     synchronous, so callbacks fire before these functions return — only
//     menu screens call in, where a beat of blocking is fine)
//   - anything else: offline — submits drop, fetches answer null
//
// Every entry point is fire-and-forget: no throw ever escapes into the
// game loop, a dead network just means an OFFLINE leaderboard.

import { LEADERBOARD } from 'data/tuning.js';

const hasFetch = typeof fetch === 'function';
const hasAthenaNet = typeof Network !== 'undefined' && typeof Request !== 'undefined' && !hasFetch;

// null = untried, false = tried and dead (never retried: DHCP on a PS2 with
// no link takes seconds, and it would hitch every screen change)
let athenaNetUp = null;

/** cache of the last successful fetchTop, so screens can paint instantly
    while a refresh is in flight (and keep something up when it fails) */
export let topCache = null;

export function leaderboardAvailable() {
  return hasFetch || (hasAthenaNet && athenaNetUp !== false);
}

function url(path) {
  return `${LEADERBOARD.host}/v1/database/${LEADERBOARD.db}/${path}`;
}

function athenaEnsureNet() {
  if (athenaNetUp !== null) return athenaNetUp;
  try {
    // already configured (launcher/OPL did it)? getConfig throws if not
    Network.getConfig();
    athenaNetUp = true;
  } catch (_) {
    try {
      Network.init(); // DHCP
      athenaNetUp = true;
    } catch (_e) {
      athenaNetUp = false;
    }
  }
  return athenaNetUp;
}

/** POST via whichever transport exists; cb(bodyText|null). PS2 is sync. */
function post(path, body, contentType, cb) {
  if (hasFetch) {
    fetch(url(path), {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => cb(text))
      .catch(() => cb(null));
    return;
  }
  if (hasAthenaNet && athenaEnsureNet()) {
    try {
      const req = new Request();
      req.headers = [`Content-Type: ${contentType}`];
      const res = req.post(url(path), body);
      cb(res === undefined || res === null ? null : String(res));
    } catch (_) {
      cb(null);
    }
    return;
  }
  cb(null);
}

/** submit a finished run; cb(ok) — optional. Bad-name/score rejections from
    the reducer land here as ok=false, same as a dead network. */
export function submitScore(entry, cb) {
  const args = JSON.stringify([
    entry.name,
    entry.score,
    entry.wave,
    entry.kills,
    entry.players,
  ]);
  post('call/submit_score', args, 'application/json', (res) => {
    if (cb) cb(res !== null);
  });
}

/** rows of the score table (name/score/wave/kills/players), sorted best
    first; cb(rows|null). Also refreshes topCache on success. */
export function fetchTop(cb) {
  post('sql', 'SELECT * FROM score', 'text/plain', (text) => {
    const rows = parseSqlRows(text);
    if (rows) {
      rows.sort((a, b) => b.score - a.score);
      topCache = rows;
    }
    cb(rows);
  });
}

/** SQL responses are [{schema, rows}] with rows as positional ProductValues
    (arrays matching the schema's element order); some encodings use objects
    keyed by column name instead. Handle both, drop anything unreadable. */
function parseSqlRows(text) {
  if (!text) return null;
  try {
    const stmts = JSON.parse(text);
    const stmt = Array.isArray(stmts) ? stmts[0] : stmts;
    if (!stmt || !Array.isArray(stmt.rows)) return null;
    const names = columnNames(stmt.schema);
    const out = [];
    for (const raw of stmt.rows) {
      const row = Array.isArray(raw) ? byNames(raw, names) : raw;
      if (!row) continue;
      const score = Number(row.score);
      if (typeof row.name !== 'string' || !isFinite(score)) continue;
      out.push({
        name: row.name,
        score,
        wave: Number(row.wave) || 0,
        kills: Number(row.kills) || 0,
        players: Number(row.players) || 0,
      });
    }
    return out;
  } catch (_) {
    return null;
  }
}

/** ProductType elements carry names as "id", {some:"id"} or {name:{some:..}}
    depending on encoder vintage — normalize to a flat list */
function columnNames(schema) {
  const els = schema && (schema.elements || (schema.Product && schema.Product.elements));
  if (!Array.isArray(els)) return null;
  return els.map((el) => {
    const n = el.name;
    if (typeof n === 'string') return n;
    if (n && typeof n.some === 'string') return n.some;
    return '';
  });
}

function byNames(values, names) {
  if (!names) return null;
  const row = {};
  for (let i = 0; i < names.length && i < values.length; i++) row[names[i]] = values[i];
  return row;
}
