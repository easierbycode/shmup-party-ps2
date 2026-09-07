// Authored waves for the arena (screens/game.js): wave n plays WAVES[n - 1]
// exactly as written here and, past the end of the list, falls back to
// lib/enemies.js's procedural buildWave() with its own boss cadence. The
// Wave Editor (wave-editor/, SAVE) writes this whole file — or hand-edit it.
// An empty list is the all-procedural game the port ships with.
//
// One wave:
//   { boss: true }                       the Evil Brain, nothing else
//   { enemies: [ { type, variant, x, y, edge, hp, speed }, ... ] }
//     type     an ENEMIES key in data/tuning.js: zombie, alien, spider,
//              beetle, crabfly, lizard, lizard-den, alien-den, spider-nest
//     variant  a VARIANTS key that reskins that base (blue-spider-1, ...),
//              optional
//     x, y     a world spot (the world is 1280x896; a little outside it
//              walks in like an edge spawn). Dens land there at wave start,
//              everything else trickles in from the spot. Optional: without
//              one the enemy walks in from a random world edge, or from
//              `edge` (0 top, 1 bottom, 2 left, 3 right) when that is given;
//              a den without a spot takes a clear floor spot of its own.
//     hp, speed  explicit stats, optional; left out they take the wave's
//              scaling, the same one the procedural roster gets.
export const WAVES = [];
