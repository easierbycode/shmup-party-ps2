// Gameplay numbers in one place. Tuned for the 640x448 single-screen arena
// (the Phaser original plays on a 1680x1050 scrolling world, so speeds and
// counts are scaled down while keeping the original's feel and ratios).

export const PLAYER = {
  hp: 3,
  maxHpCap: 5,
  speed: 170,          // px/s before perks
  radius: 16,
  invulnAfterHit: 1.0, // seconds
  knockback: 320,
  // endGrace: iframes after the dash ends, so stopping inside a crowd
  // doesn't take a hit on the very next frame
  dash: { speed: 780, time: 0.32, cooldown: 1.5, damage: 50, radius: 30, endGrace: 2 / 60 },
};

// cycled with R1 (barrier dash stays on L1, as in the original)
export const WEAPONS = [
  { id: 'ion', name: 'ION', rate: 0.3, speed: 350, dmg: 100, radius: 12, sheet: 'ion', fps: 20, impact: 'ion-impact', life: 2.5, sfx: 'ion_fire', hitSfx: 'ion_hit' },
  { id: 'ciga', name: 'CIGA', rate: 0.3, speed: 350, dmg: 100, radius: 8, sheet: 'ciga', fps: 8, scale: 2.4, impact: 'smoke', life: 2.5, sfx: 'ciga_fire', hitSfx: 'ciga_hit' },
  { id: 'pacman', name: 'PAC', rate: 0.6, speed: 600, dmg: 50, radius: 14, sheet: 'pacman', fps: 12, impact: 'pac-ghost', pierce: true, life: 1.6, sfx: 'pac_fire', hitSfx: 'pac_hit' },
];

// `score` is the global-leaderboard worth of a kill — the experience_worth of
// the Crimsonland creature each entry was ported from (creature-variants.xml),
// used verbatim. Base types without a 1:1 source use the closest standard:
// the SimpleFast tier (125) for regular wave fodder, ZombieRandonSlow (144)
// for the shambler, BeetleStandard (168) for the bruiser.
export const ENEMIES = {
  zombie: { hp: 300, speed: 70, radius: 14, anim: 10, xp: 10, score: 144 },
  alien: { hp: 200, speed: 104, radius: 15, anim: 12, xp: 10, score: 125 },
  // fragile skitterer: sprints at speed*dart.mult for minT..maxT seconds,
  // rests pauseMin..pauseMax, re-aims each dart with +/-jitter radians
  spider: {
    hp: 100, speed: 95, radius: 12, anim: 16, xp: 15, score: 125,
    dart: { mult: 2.4, minT: 0.35, maxT: 0.6, pauseMin: 0.12, pauseMax: 0.4, jitter: 0.55 },
  },
  // armored slow bruiser; pops into bodypart gibs on death
  beetle: { hp: 600, speed: 45, radius: 16, anim: 12, xp: 25, score: 168 },
  // fast flyer that weaves side to side while closing in
  crabfly: {
    hp: 130, speed: 150, radius: 12, anim: 20, xp: 15, score: 125,
    weave: { freq: 2.4, amp: 95 },
  },
  // den-hatched swarmer: quick and fragile, worth crumbs — the den it pours
  // out of is the real target
  lizard: { hp: 90, speed: 135, radius: 11, anim: 16, xp: 5, score: 125 },
  // stationary spawner, placed on the arena floor at wave start: hatches a
  // lizard every spawn.every seconds until spawn.maxAlive of its brood are
  // up, and replaces losses until the den itself is destroyed. pool is what
  // hatches: null = a plain `hatch`, a key = that VARIANTS entry (the yellow
  // lizard is what Crimsonland's DenLizardWeak spawns).
  'lizard-den': {
    hp: 800, speed: 0, radius: 22, anim: 8, xp: 50, score: 1000, // DenLizardWeak
    spawn: { every: 2.8, maxAlive: 4, hatch: 'lizard', pool: [null, null, 'blue-lizard', 'yellow-lizard'] },
  },
  // spider egg cluster — the lizard den's meaner cousin: tougher, larger
  // brood, and every hatchling is a tinted spider variant (blue spiders
  // are the house specialty, as in Crimsonland's spider dens)
  'spider-nest': {
    hp: 1000, speed: 0, radius: 20, anim: 8, xp: 60, score: 3000, // DenSpiderBasic
    spawn: {
      every: 3.2, maxAlive: 5, hatch: 'spider',
      pool: ['blue-spider-1', 'blue-spider-1', 'blue-spider-2', 'green-spider', 'red-spider'],
    },
  },
};

// Enemy variants ported from Crimsonland's creature-variants.xml: same base
// sprite and AI, different stats, size and tint. hp/speed/xp are absolute
// (same space as ENEMIES, xml ratios mapped onto this port's bases); scale
// multiplies both the draw size and the hitbox radius; tint is [r,g,b]
// multiplied over the sprite (Athena alpha 128 = neutral; `alpha` below it
// makes a variant translucent). `wave` gates heavies out of early waves.
export const VARIANTS = {
  // spiders — the nest's brood, and wave spice from variantWave on
  'blue-spider-1': { base: 'spider', hp: 100, speed: 107, scale: 0.95, xp: 20, score: 138, tint: [128, 178, 255] }, // BlueSpider1
  'blue-spider-2': { base: 'spider', hp: 90, speed: 103, scale: 0.85, xp: 19, score: 130, tint: [190, 205, 255] },  // BlueSpider2
  'red-spider': { base: 'spider', hp: 125, speed: 83, scale: 1.25, xp: 25, score: 168, tint: [255, 120, 70] },      // SpiderRandomRed
  'green-spider': { base: 'spider', hp: 95, speed: 79, scale: 0.9, xp: 20, score: 134, tint: [110, 255, 110] },     // SpiderRandomGreen
  'jerky-spider': { base: 'spider', hp: 70, speed: 190, scale: 0.9, xp: 65, score: 433, wave: 8, tint: [255, 140, 255] }, // SpiderJerky
  // aliens
  'blue-alien': { base: 'alien', hp: 230, speed: 68, scale: 1.0, xp: 13, score: 134, tint: [102, 204, 255] },       // BlueAlien
  'alien-ghost': { base: 'alien', hp: 70, speed: 150, scale: 1.05, xp: 6, score: 60, tint: [204, 255, 204], alpha: 60 }, // AlienGhost
  'alien-deadly': { base: 'alien', hp: 100, speed: 187, scale: 0.85, xp: 45, score: 450, wave: 9, tint: [255, 90, 30] },  // AlienDeadlyFast
  'alien-big-gray': { base: 'alien', hp: 850, speed: 130, scale: 1.35, xp: 45, score: 450, wave: 7, tint: [200, 255, 200] }, // AlienBigGray
  // zombies
  'red-zombie': { base: 'zombie', hp: 320, speed: 60, scale: 1.0, xp: 12, score: 144, tint: [255, 140, 140] },      // ZombieRandonSlow
  'huge-zombie': { base: 'zombie', hp: 1300, speed: 90, scale: 1.35, xp: 46, score: 460, wave: 7, tint: [230, 255, 140] }, // ZombieHugeGreen
  // beetles
  'emerald-beetle': { base: 'beetle', hp: 1400, speed: 45, scale: 1.1, xp: 45, score: 300, wave: 8, tint: [60, 200, 60] }, // BeetleEmerald
  'fire-beetle': { base: 'beetle', hp: 470, speed: 57, scale: 0.9, xp: 28, score: 180, tint: [255, 110, 30] },      // BeetleFire
  // crabflies
  'crabfly-mite': { base: 'crabfly', hp: 25, speed: 185, scale: 0.55, xp: 4, score: 40, tint: [255, 255, 180] },   // Crabfly Ammo
  // lizards — only ever den-hatched, so no wave gating needed
  'blue-lizard': { base: 'lizard', hp: 86, speed: 135, scale: 0.95, xp: 7, score: 148, tint: [110, 160, 255] },     // BlueLizard
  'yellow-lizard': { base: 'lizard', hp: 70, speed: 150, scale: 0.9, xp: 7, score: 140, tint: [255, 255, 90] },     // LizardRandomYellow
};

export const WAVE = {
  baseCount: 8,
  perWave: 4,
  spiderWave: 3,       // first wave spiders can appear
  beetleWave: 4,       // first wave beetles can appear
  crabflyWave: 5,      // first wave crabflies can appear
  denWave: 4,          // first wave lizard dens can appear
  denMax: 3,           // alive-den cap (survivors carry over between waves)
  nestWave: 6,         // first wave spider nests can appear
  nestMax: 2,          // alive-nest cap (survivors carry over, like dens)
  variantWave: 3,      // first wave tinted variants can roll
  variantChance: 0.06, // per-wave ramp of the variant roll, capped below
  variantMax: 0.4,
  maxAlive: 24,
  trickle: 0.35,       // seconds between deferred spawns once at maxAlive
  clearRatio: 0.9,     // wave ends when 90% are down (as in the original)
  breather: 2.5,       // seconds between waves
  bossEvery: 5,
};

export const BOSS = {
  scale: 2,
  eyeHp: 1500,
  blinkEvery: 250,     // eye damage between blink phases
  blinkTime: 0.75,
  fireInterval: 2.2,
  bulletSpeed: 220,
  bulletRadius: 14,
  touchRadius: 90,
  xp: 200,
  // the Evil Brain has no Crimsonland source; SpiderBoss (4500) is the
  // closest experience_worth tier among its bosses
  score: 4500,
};

// Global Survival leaderboard over SpacetimeDB's HTTP API (lib/leaderboard.js).
// Anonymous calls: submit via the submitScore reducer, read via SQL on the
// public score table. Point an OPL/LAN build at a local instance by swapping
// host for e.g. 'http://192.168.0.10:3000'.
export const LEADERBOARD = {
  host: 'https://maincloud.spacetimedb.com',
  db: 'shmup-party-leaderboard',
  top: 10,       // rows shown on the game-over board
  titleTop: 3,   // rows on the title screen (what fits above PRESS START)
};

export const POWERUPS = {
  dropChance: 0.2,
  lifespan: 12,
  radius: 18,
  types: ['speed', 'fireblast', 'boost', 'medikit', 'nuke', 'chomp', 'freeze'],
  speedMult: 1.8,
  speedTime: 7,
  giantTime: 7,
  giantScale: 2,       // player draw + hitbox multiplier while giant
  giantTouchDps: 400,  // damage/sec dealt to anything the giant player touches
  nukeDamage: 400,
  nukeRadius: 320,
  nukeTime: 0.75,
  fireblastCount: 16,
  fireblastDmg: 60,
  fireblastSpeed: 400,
  // chomp ball: orbits the player chewing through anything it sweeps past.
  // A target is only caught where the swing lines up with it, so the ball
  // reaches a ring of |chompRadius - distance| <= chompBallRadius + its radius:
  // 52 keeps that ring starting inside melee range, where the horde piles up.
  // chompHit gives the same target a beat between bites, so lingering in the
  // swing costs it a few hundred hp rather than everything in two frames.
  chompTime: 15,
  chompRadius: 52,      // orbit distance from the player, px
  chompSpin: 3.6,       // radians/sec
  chompBallRadius: 16,
  chompDamage: 300,     // one-shots zombies and aliens, as in the original
  chompHit: 0.25,       // seconds before the same target can be hit again
  // freeze: locks the whole horde (and the boss) in place. Enemies with an
  // active shield (shieldActive — none yet; the spiderBoss will have one)
  // shrug it off. Frozen targets still take damage and still hurt on touch.
  freezeTime: 5,
};

// DualShock 2 rumble pulses (lib/haptics.js). big: 0-255 motor intensity
// (the DS2 big motor barely spins below ~100); small: on/off; time: seconds.
export const HAPTICS = {
  hurt: { big: 200, small: 1, time: 0.25 },
  death: { big: 255, small: 1, time: 0.8 },
  dash: { big: 0, small: 1, time: 0.1 },
  pickup: { big: 0, small: 1, time: 0.06 },
  nuke: { big: 255, small: 0, time: 0.5 },
  bossIncoming: { big: 130, small: 0, time: 0.6 },
  bossDown: { big: 255, small: 1, time: 0.9 },
};

export const PERKS = [
  { type: 'speed', name: 'SPEED BOOST', desc: '+20% MOVE SPEED', icon: 'perk-speed' },
  { type: 'fireRate', name: 'RAPID FIRE', desc: '+20% FIRE RATE', icon: 'perk-fire-rate' },
  { type: 'damage', name: 'HEAVY HITTER', desc: '+50% DAMAGE', icon: 'perk-damage' },
];

export const XP_PER_LEVEL = 100;
