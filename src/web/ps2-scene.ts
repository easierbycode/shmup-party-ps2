// The browser host scene. Preloads every ps2/assets PNG as a texture keyed
// by its AthenaEnv path ("assets/foo.png"), builds the 5velte-ps2 runtime,
// installs the AthenaEnv globals, then imports the very same ps2/main.js
// that boots on real hardware and drives it one tick per Phaser frame.

import Phaser from 'phaser'
import { createRuntime, type PS2Runtime } from '5velte-ps2'
import { createPhaserHost } from '5velte-ps2/phaser'
import { WebPadSource } from './pad-source.ts'
import { makeMultiPads } from './multi-pads.ts'
import { makeSoundShim } from './sound-shim.ts'

const assetUrls = import.meta.glob('../../ps2/assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

// browser-playable twins of the .adp sfx the PS2 build loads
const sfxUrls = import.meta.glob('../../ps2/assets/sfx/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export default class Ps2Scene extends Phaser.Scene {
  private runtime?: PS2Runtime
  private pads = new WebPadSource()
  private destroyHost?: () => void
  private ready = false

  constructor() {
    super({ key: 'Ps2Scene' })
  }

  preload() {
    for (const [path, url] of Object.entries(assetUrls)) {
      const name = path.split('/').pop()!
      this.load.image(`assets/${name}`, url)
    }
    for (const [path, url] of Object.entries(sfxUrls)) {
      const name = path.split('/').pop()!
      this.load.audio(`assets/sfx/${name}`, url)
    }
  }

  create() {
    const { host, destroy } = createPhaserHost({
      scene: this,
      pads: this.pads,
      resolveTexture: (path) => path,
      // the game renders text through its own bitmap-font sheet, so the
      // Font module is never exercised — this keeps the host contract happy
      resolveFont: () => ({ key: 'assets/font.png' }),
    })
    this.destroyHost = destroy
    this.runtime = createRuntime(host)

    // AthenaEnv's globals, exactly as a real PS2 provides them. Installed
    // after preload so shadowing window.Image can't break Phaser's loader.
    const g = globalThis as Record<string, unknown>
    const r = this.runtime
    g.Screen = r.Screen
    g.Draw = r.Draw
    g.Color = r.Color
    // runtime.Pads is single-port by design; the game spawns one player per
    // connected port, so the browser build needs the per-port view instead
    g.Pads = makeMultiPads(this.pads)
    // Sound isn't in the 5velte-ps2 runtime — the local shim plays the .wav
    // twins of the .adp sfx through Phaser's sound manager
    g.Sound = makeSoundShim(this)
    g.Image = r.Image
    g.Font = r.Font
    g.Timer = r.Timer
    g.std = r.std
    g.NEAREST = r.NEAREST
    g.LINEAR = r.LINEAR

    import('../../ps2/main.js').then(() => {
      this.ready = true
    })

    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.destroyHost?.()
      this.pads.destroy()
    })
  }

  update() {
    if (!this.ready || !this.runtime) return
    this.pads.refresh()
    this.runtime.tick()
  }
}
