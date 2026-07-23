// Per-frame delta time from an AthenaEnv microsecond timer, clamped so a
// paused emulator tab or disc seek can't produce a physics explosion.

const timer = Timer.new();

export function dtSeconds() {
  const us = Timer.getTime(timer);
  Timer.reset(timer);
  return Math.min(us / 1e6, 0.05);
}
