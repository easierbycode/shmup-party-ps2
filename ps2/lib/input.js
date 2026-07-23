// Pad polling with analog deadzone, in ps2-mario's Pads.get-per-frame style.
// Works identically on real AthenaEnv pads and the 5velte-ps2 browser shim
// (where port 0 answers keyboard + Gamepad API input).

const DEADZONE = 30;

function axis(v) {
  return Math.abs(v) < DEADZONE ? 0 : clampAxis(v / 127);
}

function clampAxis(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export function pollPad(port) {
  const pad = Pads.get(port);
  return {
    held: (mask) => pad.pressed(mask),
    just: (mask) => pad.justPressed(mask),
    lx: axis(pad.lx),
    ly: axis(pad.ly),
    rx: axis(pad.rx),
    ry: axis(pad.ry),
  };
}

/** ports that currently have a controller (browser shim: always [0]) */
export function connectedPorts() {
  const ports = Pads.getConnected();
  return ports && ports.length ? ports : [0];
}
