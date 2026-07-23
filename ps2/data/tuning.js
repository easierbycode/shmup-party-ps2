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
  dash: { speed: 780, time: 0.32, cooldown: 1.5, damage: 50, radius: 30 },
};

// cycled with R1 (barrier dash stays on L1, as in the original)
export const WEAPONS = [
  { id: 'ion', name: 'ION', rate: 0.3, speed: 350, dmg: 100, radius: 12, sheet: 'ion', rotated: true, impact: 'ion-impact', life: 2.5 },
  { id: 'ciga', name: 'CIGA', rate: 0.3, speed: 350, dmg: 100, radius: 8, sheet: 'ciga', fps: 8, scale: 2.4, impact: 'smoke', life: 2.5 },
  { id: 'pacman', name: 'PAC', rate: 0.6, speed: 600, dmg: 50, radius: 14, sheet: 'pacman', fps: 12, impact: 'pac-ghost', pierce: true, life: 1.6 },
];

export const ENEMIES = {
  zombie: { hp: 300, speed: 70, radius: 14, anim: 10, xp: 10 },
  alien: { hp: 200, speed: 104, radius: 15, anim: 12, xp: 10 },
};

export const WAVE = {
  baseCount: 8,
  perWave: 4,
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
};

export const POWERUPS = {
  dropChance: 0.2,
  lifespan: 12,
  radius: 18,
  types: ['speed', 'fireblast', 'boost', 'medikit', 'nuke'],
  speedMult: 1.8,
  speedTime: 7,
  giantTime: 7,
  nukeDamage: 400,
  nukeRadius: 320,
  nukeTime: 0.75,
  fireblastCount: 16,
  fireblastDmg: 60,
  fireblastSpeed: 400,
};

export const PERKS = [
  { type: 'speed', name: 'SPEED BOOST', desc: '+20% MOVE SPEED', icon: 'perk-speed' },
  { type: 'fireRate', name: 'RAPID FIRE', desc: '+20% FIRE RATE', icon: 'perk-fire-rate' },
  { type: 'damage', name: 'HEAVY HITTER', desc: '+50% DAMAGE', icon: 'perk-damage' },
];

export const XP_PER_LEVEL = 100;
