// Title screen: logo, PRESS START, controls. Any pad's START (or CROSS)
// drops into the arena — matching the menu flow of the Svelte original,
// trimmed to the survival mode the port ships.

import { screens } from 'lib/screens.js';
import { pollPad, connectedPorts } from 'lib/input.js';
import { P } from 'lib/sprites.js';
import { drawTextCentered } from 'lib/text.js';
import { SCREEN_W, SCREEN_H } from 'lib/util.js';

const GREEN = () => Color.new(156, 255, 107, 128);
const DIM = (a) => Color.new(190, 220, 190, a);

export default class TitleScreen {
  onEnter() {
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    for (const port of connectedPorts()) {
      const pad = pollPad(port);
      if (pad.just(Pads.START) || pad.just(Pads.CROSS)) {
        screens.change('game');
        return;
      }
    }
  }

  render() {
    P('bg').draw(0, 0, { color: Color.new(120, 120, 120, 128) });
    Draw.rect(0, 0, SCREEN_W, SCREEN_H, Color.new(0, 0, 0, 55));

    P('logo').center(SCREEN_W / 2, 120, { w: 600, h: 48 });
    drawTextCentered(SCREEN_W / 2, 152, 'SURVIVAL MODE', { color: DIM(100) });

    if (Math.floor(this.t * 2) % 2 === 0) {
      drawTextCentered(SCREEN_W / 2, SCREEN_H / 2 + 36, 'PRESS START', { scale: 2, color: GREEN() });
    }

    const y = SCREEN_H - 120;
    drawTextCentered(SCREEN_W / 2, y, 'LEFT STICK: MOVE   RIGHT STICK: AIM + FIRE', { color: DIM(110) });
    drawTextCentered(SCREEN_W / 2, y + 22, 'CROSS: AUTO-AIM FIRE   L1: BARRIER DASH', { color: DIM(110) });
    drawTextCentered(SCREEN_W / 2, y + 44, 'R1: CYCLE WEAPON   START: PAUSE   SELECT: RESTART', { color: DIM(110) });

    drawTextCentered(SCREEN_W / 2, SCREEN_H - 30, "SH'M UP PARTY - PS2 - 5VELTE-PS2 x ATHENAENV", { color: DIM(70) });
  }
}
