// Browser-only wave overrides for the arena, read off the play page's URL
// before ps2/main.js boots and parked on the globals ps2/lib/waves.js
// checks:
//   ?waves=local        the list the Wave Editor saved to localStorage (its
//                       TEST button; the editor is a page of this same site)
//   ?waves=<base64url>  a JSON wave list inline
//   ?wave=<n>           open the run on wave n instead of wave 1
//   ?offline=1          play locally — no SpacetimeDB lobby, so START never
//                       joins (or spectates) a run that is live elsewhere
// Nothing here runs on the PS2 or Switch hosts, which only ever see the
// baked ps2/data/waves.js.

import { WAVES_STORAGE_KEY } from '../waves-key.ts'

export function installWavesOverride(search = location.search) {
  const params = new URLSearchParams(search)
  const g = globalThis as Record<string, unknown>
  const waves = params.get('waves')
  if (waves) {
    const list = readWaves(waves)
    if (list) g.SHMUP_WAVES = list
    else console.warn('[waves] ?waves= is not a wave list — playing the baked waves')
  }
  const wave = Number(params.get('wave'))
  if (Number.isInteger(wave) && wave > 1) g.SHMUP_START_WAVE = wave
  if (params.has('offline')) g.SHMUP_OFFLINE = true
}

function readWaves(spec: string): unknown[] | null {
  let text: string | null = null
  try {
    text = spec === 'local'
      ? localStorage.getItem(WAVES_STORAGE_KEY)
      : new TextDecoder().decode(base64urlBytes(spec))
  } catch {
    return null
  }
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    return parsed && Array.isArray(parsed.waves) ? parsed.waves : null
  } catch {
    return null
  }
}

function base64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
