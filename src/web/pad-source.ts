// PadSource for 5velte-ps2's Phaser host: answers PS2 button-mask queries
// from the keyboard (arrows/WASD + Enter/Shift/Space/Q/E) and up to four
// connected Gamepads (standard mapping), one per PS2 port. refresh() runs
// once per frame, before runtime.tick(), so justPressed edges line up with
// game frames.
//
// Sh'M↑ Party is a 2-4 player local party game, so the browser build has to
// answer per-port like real hardware does. The base 5velte-ps2 runtime is
// single-port (its Pads.getConnected() hard-returns [0]); makeMultiPads in
// ./multi-pads.ts wraps this source to provide the per-port Pads global.

import { PAD_BUTTONS } from '5velte-ps2'
import type { PadSource } from '5velte-ps2/phaser'

/** PS2 multitap tops out at 4 controllers, and so does the game. */
export const MAX_PORTS = 4

export type AxisName = 'lx' | 'ly' | 'rx' | 'ry'

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

interface PortState {
  cur: number
  prev: number
  lx: number
  ly: number
  rx: number
  ry: number
}

export class WebPadSource implements PadSource {
  private keysDown = new Set<string>()
  /** slots[port] = the Gamepad.index driving that port, or null if free */
  private slots: Array<number | null> = new Array(MAX_PORTS).fill(null)
  private state: PortState[] = Array.from({ length: MAX_PORTS }, () => ({
    cur: 0,
    prev: 0,
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
  }))

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
    const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    const live = new Map<number, Gamepad>()
    for (const pad of gamepads) if (pad && pad.connected) live.set(pad.index, pad)

    // Ports are assigned on first sight and held until that pad goes away, so
    // unplugging player 2 never renumbers players 3 and 4 mid-game.
    for (let port = 0; port < MAX_PORTS; port++) {
      const assigned = this.slots[port]
      if (assigned !== null && !live.has(assigned)) this.slots[port] = null
    }
    for (const index of live.keys()) {
      if (this.slots.includes(index)) continue
      const free = this.slots.indexOf(null)
      if (free !== -1) this.slots[free] = index
    }

    let keyMask = 0
    for (const code of this.keysDown) keyMask |= KEY_MAP[code] ?? 0

    for (let port = 0; port < MAX_PORTS; port++) {
      const s = this.state[port]
      s.prev = s.cur
      s.lx = s.ly = s.rx = s.ry = 0
      // the keyboard always shares port 0, so solo keyboard play still works
      let mask = port === 0 ? keyMask : 0
      const index = this.slots[port]
      const pad = index === null ? undefined : live.get(index)
      if (pad) {
        pad.buttons.forEach((b, i) => {
          if (b.pressed && GAMEPAD_MAP[i] !== undefined) mask |= GAMEPAD_MAP[i]!
        })
        s.lx = pad.axes[0] ?? 0
        s.ly = pad.axes[1] ?? 0
        s.rx = pad.axes[2] ?? 0
        s.ry = pad.axes[3] ?? 0
      }
      s.cur = mask
    }
  }

  /** ports with a controller; port 0 is always present for the keyboard */
  connectedPorts(): number[] {
    const ports: number[] = []
    for (let port = 0; port < MAX_PORTS; port++) {
      if (this.slots[port] !== null) ports.push(port)
    }
    if (!ports.includes(0)) ports.unshift(0)
    return ports
  }

  heldAt(port: number, mask: number) {
    const s = this.state[port]
    return s !== undefined && (s.cur & mask) !== 0
  }

  freshAt(port: number, mask: number) {
    const s = this.state[port]
    return s !== undefined && (s.cur & mask) !== 0 && (s.prev & mask) === 0
  }

  axisAt(port: number, name: AxisName) {
    return this.state[port]?.[name] ?? 0
  }

  /** AthenaEnv Pads.rumble semantics: big is 0-255 intensity, small on/off */
  rumbleAt(port: number, big: number, small: number) {
    const index = this.slots[port]
    if (index === null || index === undefined) return
    // Gamepad objects are per-poll snapshots in Chrome, so fetch a live one
    const pad = navigator.getGamepads?.()[index]
    const actuator = pad?.vibrationActuator
    if (!actuator) return
    if (big > 0 || small) {
      // the game (ps2/lib/haptics.js) re-sends on change and sends an
      // explicit 0,0 stop, so the duration only has to outlive a pulse
      actuator
        .playEffect('dual-rumble', {
          duration: 2000,
          strongMagnitude: Math.min(1, Math.max(0, big / 255)),
          weakMagnitude: small ? 0.7 : 0,
        })
        .catch(() => {})
    } else {
      actuator.reset().catch(() => {})
    }
  }

  // PadSource contract — the host's single-port view, which is port 0.
  held(mask: number) {
    return this.heldAt(0, mask)
  }

  fresh(mask: number) {
    return this.freshAt(0, mask)
  }

  axis(name: AxisName) {
    return this.axisAt(0, name)
  }
}
