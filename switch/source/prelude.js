// Pure-JS half of the Switch host, evaluated before ps2/main.js.
// Color and Timer need no native state beyond __nowUs (host_screen.c), so
// they live here instead of C — same packing AthenaEnv and 5velte-ps2 use.
//
// Alpha rides bits 24-31 with the AthenaEnv 0-128 scale (128 = opaque); the
// word goes negative when a >= 128, which is fine — every C-side consumer
// decodes via JS_ToUint32.

globalThis.NEAREST = 0;
globalThis.LINEAR = 1;

globalThis.Color = {
  new: (r, g, b, a = 128) =>
    (r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24),
  getR: (c) => c & 255,
  getG: (c) => (c >> 8) & 255,
  getB: (c) => (c >> 16) & 255,
};

globalThis.Timer = {
  new: () => ({ t: __nowUs() }),
  getTime: (h) => __nowUs() - h.t, // microseconds, like AthenaEnv
  reset: (h) => {
    h.t = __nowUs();
  },
};
