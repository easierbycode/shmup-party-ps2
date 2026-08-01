// Sh'M↑ Party — PlayStation 2 (AthenaEnv v4).
//
// The same code runs in two places:
//   - real PS2 / PCSX2 / Play!: AthenaEnv provides the globals (Screen,
//     Draw, Color, Image, Pads, Timer, std) natively and boots this file
//     via athena.ini's default_script.
//   - the browser: the Svelte shell (src/web/ps2-scene.ts) installs the
//     same globals from 5velte-ps2's Phaser 4 host, then imports this file.

import { screens } from 'lib/screens.js';
import { initAudio } from 'lib/audio.js';
import TitleScreen from 'screens/title.js';
import DemoScreen from 'screens/demo.js';
import GameScreen from 'screens/game.js';
import GameOverScreen from 'screens/gameover.js';

// Recent AthenaEnv builds boot the GS half-initialized; re-applying the
// current mode runs the full display setup (display offsets + flip). Without
// it the interlaced 640x448 framebuffer shows alternating black scanlines on
// hardware — see ps2-ryu's main.js. The browser shim has no setMode.
if (typeof Screen.setMode === 'function') Screen.setMode(Screen.getMode());
// AthenaEnv's current (owl-renderer) builds boot with GS depth testing on but
// never allocate a Z-buffer, so Z reads/writes alias framebuffer memory:
// every other flip shows an all-black buffer and any sprite drawn over
// already-bright pixels loses the depth test and vanishes. This 2D game
// draws strictly painter's-order, so turn depth testing off (the 2019-ps2
// port does the same; the browser and Switch hosts have no setParam).
if (typeof Screen.setParam === 'function') Screen.setParam(Screen.DEPTH_TEST_ENABLE, 0);
Screen.setVSync(true);
initAudio();

screens.register('title', new TitleScreen());
screens.register('demo', new DemoScreen());
screens.register('game', new GameScreen());
screens.register('gameover', new GameOverScreen());
screens.change('title');

Screen.display(() => {
  screens.tick();
});
