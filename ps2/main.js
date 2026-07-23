// Sh'M↑ Party — PlayStation 2 (AthenaEnv v4).
//
// The same code runs in two places:
//   - real PS2 / PCSX2 / Play!: AthenaEnv provides the globals (Screen,
//     Draw, Color, Image, Pads, Timer, std) natively and boots this file
//     via athena.ini's default_script.
//   - the browser: the Svelte shell (src/web/ps2-scene.ts) installs the
//     same globals from 5velte-ps2's Phaser 4 host, then imports this file.

import { screens } from 'lib/screens.js';
import TitleScreen from 'screens/title.js';
import GameScreen from 'screens/game.js';

// Recent AthenaEnv builds boot the GS half-initialized; re-applying the
// current mode runs the full display setup (display offsets + flip). Without
// it the interlaced 640x448 framebuffer shows alternating black scanlines on
// hardware — see ps2-ryu's main.js. The browser shim has no setMode.
if (typeof Screen.setMode === 'function') Screen.setMode(Screen.getMode());
Screen.setVSync(true);

screens.register('title', new TitleScreen());
screens.register('game', new GameScreen());
screens.change('title');

Screen.display(() => {
  screens.tick();
});
