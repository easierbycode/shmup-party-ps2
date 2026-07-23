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

Screen.setVSync(true);

screens.register('title', new TitleScreen());
screens.register('game', new GameScreen());
screens.change('title');

Screen.display(() => {
  screens.tick();
});
