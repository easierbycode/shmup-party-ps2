// PadSource for 5velte-ps2's Phaser host: answers PS2 button-mask queries
// from the keyboard (arrows/WASD + Enter/Shift/Space/Q/E) and the first
// connected Gamepad (standard mapping). refresh() runs once per frame,
// before runtime.tick(), so justPressed edges line up with game frames.

import { PAD_BUTTONS } from '5velte-ps2'
import type { PadSource } from '5velte-ps2/phaser'

// standard-mapping gamepad button index -> PS2 mask
const GAMEPAD_MAP: Array<number | undefined> = [
  PAD_BUTTONS.CROSS, // 0
  PAD_BUTTONS.CIRCLE, // 1
  PAD_BUTTONS.SQUARE, // 2
  PAD_BUTTONS.TRIANGLE, // 3
  PAD_BUTTONS.L1, // 4
  PAD_BUTTONS.R1, // 5
  PAD_BUTTONS.L2, // 6
  PAD_BUTTONS.R2, // 7
  PAD_BUTTONS.SELECT, // 8
  PAD_BUTTONS.START, // 9
  PAD_BUTTONS.L3, // 10
  PAD_BUTTONS.R3, // 11
  PAD_BUTTONS.UP, // 12
  PAD_BUTTONS.DOWN, // 13
  PAD_BUTTONS.LEFT, // 14
  PAD_BUTTONS.RIGHT, // 15
]

const KEY_MAP: Record<string, number> = {
  ArrowUp: PAD_BUTTONS.UP,
  ArrowDown: PAD_BUTTONS.DOWN,
  ArrowLeft: PAD_BUTTONS.LEFT,
  ArrowRight: PAD_BUTTONS.RIGHT,
  KeyW: PAD_BUTTONS.UP,
  KeyS: PAD_BUTTONS.DOWN,
  KeyA: PAD_BUTTONS.LEFT,
  KeyD: PAD_BUTTONS.RIGHT,
  Enter: PAD_BUTTONS.START,
  ShiftLeft: PAD_BUTTONS.SELECT,
  ShiftRight: PAD_BUTTONS.SELECT,
  Space: PAD_BUTTONS.CROSS,
  KeyX: PAD_BUTTONS.CROSS,
  KeyQ: PAD_BUTTONS.L1,
  KeyE: PAD_BUTTONS.R1,
}

export class WebPadSource implements PadSource {
  private keysDown = new Set<string>()
  private cur = 0
  private prev = 0
  private axes = { lx: 0, ly: 0, rx: 0, ry: 0 }

  private onKeyDown = (e: KeyboardEvent) => {
    if (KEY_MAP[e.code] !== undefined) {
      e.preventDefault()
      this.keysDown.add(e.code)
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.code)
  }

  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
  }

  /** call once per frame, before runtime.tick() */
  refresh() {
    this.prev = this.cur
    let mask = 0
    for (const code of this.keysDown) mask |= KEY_MAP[code] ?? 0

    this.axes.lx = this.axes.ly = this.axes.rx = this.axes.ry = 0
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    for (const pad of pads) {
      if (!pad || !pad.connected) continue
      pad.buttons.forEach((b, i) => {
        if (b.pressed && GAMEPAD_MAP[i] !== undefined) mask |= GAMEPAD_MAP[i]!
      })
      this.axes.lx = pad.axes[0] ?? 0
      this.axes.ly = pad.axes[1] ?? 0
      this.axes.rx = pad.axes[2] ?? 0
      this.axes.ry = pad.axes[3] ?? 0
      break // first connected pad drives port 0
    }
    this.cur = mask
  }

  held(mask: number) {
    return (this.cur & mask) !== 0
  }

  fresh(mask: number) {
    return (this.cur & mask) !== 0 && (this.prev & mask) === 0
  }

  axis(name: 'lx' | 'ly' | 'rx' | 'ry') {
    return this.axes[name]
  }
}
