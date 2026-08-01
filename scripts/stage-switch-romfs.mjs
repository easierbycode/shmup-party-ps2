#!/usr/bin/env node
// Stage the ps2/ game tree into switch/romfs for the NRO build.
//
// Mirrors scripts/build-athena-iso.ts's selection — everything the PS2 ISO
// carries except athena.elf/athena.ini — plus the .wav sfx twins instead of
// the audsrv .adp files (SDL2_mixer plays WAV; switch/source/host_sound.c
// rewrites the extension the game asks for). Names are already lowercase
// underscore (ISO9660 discipline, ps2/lib/sprites.js) and romfs is
// byte-exact, so files copy verbatim.
import { cpSync, copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ps2 = join(root, 'ps2')
const out = join(root, 'switch', 'romfs')

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'game', 'assets', 'sfx'), { recursive: true })
mkdirSync(join(out, 'host'), { recursive: true })

// game code, same relative layout the module loader resolves against
copyFileSync(join(ps2, 'main.js'), join(out, 'game', 'main.js'))
for (const dir of ['lib', 'screens', 'data']) {
  cpSync(join(ps2, dir), join(out, 'game', dir), { recursive: true })
}

let pngs = 0
for (const f of readdirSync(join(ps2, 'assets'))) {
  if (!f.endsWith('.png')) continue
  copyFileSync(join(ps2, 'assets', f), join(out, 'game', 'assets', f))
  pngs++
}

let wavs = 0
for (const f of readdirSync(join(ps2, 'assets', 'sfx'))) {
  if (!f.endsWith('.wav')) continue
  copyFileSync(join(ps2, 'assets', 'sfx', f), join(out, 'game', 'assets', 'sfx', f))
  wavs++
}

// the host's own JS half (Color/Timer), evaluated before main.js
copyFileSync(join(root, 'switch', 'source', 'prelude.js'), join(out, 'host', 'prelude.js'))

console.log(`staged switch/romfs: game tree + ${pngs} png + ${wavs} wav`)
