// AthenaEnv v4's Sound module on Phaser's sound manager — just enough for
// the game's ADPCM sfx calls (lib/audio.js). Sfx paths arrive with the .adp
// extension the PS2 build ships; the browser plays the .wav twin that
// scripts/prep-assets.py generates alongside each .adp.
//
// Sound.Stream (wav/ogg music) is intentionally absent: the game doesn't
// use it, and a missing method fails loud rather than silently no-opping.

import type Phaser from 'phaser'

export interface ShimSfx {
  volume: number
  pan: number
  pitch: number
  readonly length: number
  play(channel?: number): number
  playing(channel: number): boolean
  free(): void
}

export function makeSoundShim(scene: Phaser.Scene) {
  const missing = new Set<string>()

  // plain function, matching AthenaEnv where both Sound.Sfx(p) and
  // new Sound.Sfx(p) construct a sound effect
  function Sfx(path: string): ShimSfx {
    const key = path.replace(/\.adp$/, '.wav')
    return {
      volume: 100, // AthenaEnv range 0-100, applied on the next play
      pan: 0,
      pitch: 0,
      get length() {
        const buffer = scene.cache.audio.get(key) as { duration?: number } | undefined
        return buffer && typeof buffer.duration === 'number' ? Math.round(buffer.duration * 1000) : 0
      },
      play() {
        if (!scene.cache.audio.exists(key)) {
          if (!missing.has(key)) {
            missing.add(key)
            console.warn(`[sound-shim] audio "${key}" is not loaded`)
          }
          return -1
        }
        scene.sound.play(key, { volume: Math.max(0, Math.min(100, this.volume)) / 100 })
        return 0
      },
      playing() {
        return false
      },
      free() {},
    }
  }

  return {
    Sfx,
    setVolume(v: number) {
      scene.sound.setVolume(Math.max(0, Math.min(100, v)) / 100)
    },
    // the browser has no 24-channel limit; report the first channel free
    findChannel() {
      return 0
    },
  }
}
