// A per-port Pads global for the browser build.
//
// 5velte-ps2's own runtime Pads is deliberately single-port: get() ignores the
// port, getConnected() returns [0]. That is fine for a one-player demo but
// Sh'M↑ Party spawns one player per connected port (ps2/screens/game.js), so
// on the web only player 1 would ever appear. This wraps WebPadSource to
// answer per port, matching the shape AthenaEnv's Pads module provides on
// real hardware, and is installed over runtime.Pads in ps2-scene.ts.

import { PAD_BUTTONS } from '5velte-ps2'
import type { AxisName, WebPadSource } from './pad-source.ts'

/** web -1..1 to AthenaEnv's asymmetric -127..128 (raw 0..255 - 127) */
const toAthenaAxis = (v: number) => Math.round(v < 0 ? v * 127 : v * 128)

export function makeMultiPads(source: WebPadSource) {
  const makePad = (port: number) => {
    // assigned axis values shadow the live reading until update(), which is
    // the AthenaEnv deadzone idiom (`pad.lx = 0`) the runtime also honours
    const override: Partial<Record<AxisName, number>> = {}
    const axis = (name: AxisName) => override[name] ?? toAthenaAxis(source.axisAt(port, name))

    return {
      btns: 0,
      old_btns: 0,
      get lx() {
        return axis('lx')
      },
      set lx(v: number) {
        override.lx = v
      },
      get ly() {
        return axis('ly')
      },
      set ly(v: number) {
        override.ly = v
      },
      get rx() {
        return axis('rx')
      },
      set rx(v: number) {
        override.rx = v
      },
      get ry() {
        return axis('ry')
      },
      set ry(v: number) {
        override.ry = v
      },
      update() {
        this.old_btns = this.btns
        delete override.lx
        delete override.ly
        delete override.rx
        delete override.ry
      },
      pressed(mask: number) {
        return source.heldAt(port, mask)
      },
      justPressed(mask: number) {
        return source.freshAt(port, mask)
      },
    }
  }

  return {
    ...PAD_BUTTONS,
    get(port = 0) {
      return makePad(port)
    },
    getConnected() {
      return source.connectedPorts()
    },
    getConnectedCount() {
      return source.connectedPorts().length
    },
    isActive(port: number) {
      return source.connectedPorts().includes(port)
    },
  }
}
