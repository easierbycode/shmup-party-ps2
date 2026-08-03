// DualShock 2 rumble. buzz(port, kind) starts a HAPTICS[kind] pulse;
// updateHaptics(dt) runs the timers once per frame and forwards each port's
// combined state to Pads.rumble — but only when it changes, because every
// call is a command on the pad bus (and the browser shim's Gamepad effect
// restarts on each call).
//
// DS2 motor semantics, which the web shim mirrors: big is 0-255 intensity,
// small is on/off.

import { HAPTICS } from 'data/tuning.js';

const pulses = new Map(); // port -> [{ big, small, t }]
const sent = new Map(); // port -> last { big, small } pushed to the pad

const canRumble = () => typeof Pads.rumble === 'function';

function send(port, big, small) {
  const last = sent.get(port);
  if (last && last.big === big && last.small === small) return;
  sent.set(port, { big, small });
  Pads.rumble(port, big, small);
}

export function buzz(port, kind) {
  if (port < 0) return; // virtual pads (demo AI, remote net players) have no motor
  const spec = HAPTICS[kind];
  let list = pulses.get(port);
  if (!list) pulses.set(port, (list = []));
  list.push({ big: spec.big, small: spec.small, t: spec.time });
}

export function updateHaptics(dt) {
  for (const [port, list] of pulses) {
    for (let i = list.length - 1; i >= 0; i--) {
      list[i].t -= dt;
      if (list[i].t <= 0) list.splice(i, 1);
    }
    // overlapping pulses don't sum (a motor can't); the loudest one wins
    let big = 0;
    let small = 0;
    for (const p of list) {
      if (p.big > big) big = p.big;
      if (p.small) small = 1;
    }
    if (canRumble()) send(port, big, small);
    if (list.length === 0) pulses.delete(port);
  }
}

/** silence every motor (leaving the game screen) */
export function stopHaptics() {
  pulses.clear();
  if (canRumble()) {
    for (const [port, last] of sent) {
      if (last.big || last.small) Pads.rumble(port, 0, 0);
    }
  }
  sent.clear();
}
