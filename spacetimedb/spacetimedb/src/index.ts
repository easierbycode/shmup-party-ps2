// Global Survival-mode leaderboard for Sh'M↑ Party PS2.
//
// One public `score` table, one anonymous reducer. The reducer trims the
// table to the top MAX_ROWS after every insert, so clients (the game's
// ps2/lib/leaderboard.js) read the whole table with one-off SQL and sort
// client-side — no ORDER BY needed.
//
// Point values are the game's per-kill scores, which come from Crimsonland's
// creature-variants.xml experience_worth (see ps2/data/tuning.js).

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

const spacetimedb = schema({ score });
export default spacetimedb;

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
