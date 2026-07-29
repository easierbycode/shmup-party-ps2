// Game over: arcade initials entry, then the global Survival leaderboard.
// The run's tally arrives via screens.change('gameover', {score, wave,
// kills, players}). Submission and the board both ride lib/leaderboard.js;
// with no network the screen degrades to the run's own numbers.

import { screens } from 'lib/screens.js';
import { sfx, tickAudio } from 'lib/audio.js';
import { pollPad, connectedPorts } from 'lib/input.js';
import { P } from 'lib/sprites.js';
import { drawTextCentered } from 'lib/text.js';
import { SCREEN_W, SCREEN_H } from 'lib/util.js';
import { LEADERBOARD } from 'data/tuning.js';
import { leaderboardAvailable, submitScore, fetchTop, topCache } from 'lib/leaderboard.js';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REPEAT_DELAY = 0.4; // holding up/down scrolls the letter wheel
const REPEAT_EVERY = 0.08;

const WHITE = () => Color.new(255, 255, 255, 128);
const GREEN = () => Color.new(156, 255, 107, 128);
const RED = () => Color.new(255, 64, 64, 128);
const YELLOW = () => Color.new(246, 255, 74, 128);
const DIM = (a) => Color.new(190, 220, 190, a);

export default class GameOverScreen {
  onEnter(run) {
    this.run = run || { score: 0, wave: 0, kills: 0, players: 1 };
    this.t = 0;
    this.initials = ['A', 'A', 'A'];
    this.slot = 0;
    this.holdDir = 0;
    this.holdT = 0;
    this.rows = topCache;
    this.rank = null;
    this.message = null;
    if (leaderboardAvailable()) {
      this.state = 'entry';
      // warm the board while initials are being picked
      fetchTop((rows) => { if (rows && this.state !== 'board') this.rows = rows; });
    } else {
      this.state = 'board';
      this.message = 'LEADERBOARD OFFLINE';
    }
  }

  update(dt) {
    this.t += dt;
    tickAudio(dt);
    if (this.state === 'entry') this.updateEntry(dt);
    else if (this.state === 'board') this.updateBoard();
    // 'sending' just waits for the submit callback
  }

  updateEntry(dt) {
    let dir = 0;
    for (const port of connectedPorts()) {
      const pad = pollPad(port);
      if (pad.held(Pads.UP) || pad.ly < -0.5) dir = 1;
      else if (pad.held(Pads.DOWN) || pad.ly > 0.5) dir = -1;
      if (pad.just(Pads.LEFT)) this.moveSlot(-1);
      if (pad.just(Pads.RIGHT)) this.moveSlot(1);
      if (pad.just(Pads.CROSS)) {
        sfx('button_press');
        if (this.slot < 2) this.slot++;
        else this.submit();
        return;
      }
      if (pad.just(Pads.START)) {
        this.submit();
        return;
      }
    }
    // letter wheel: step once on press, auto-repeat while held
    if (dir !== this.holdDir) {
      this.holdDir = dir;
      this.holdT = REPEAT_DELAY;
      if (dir) this.spin(dir);
    } else if (dir) {
      this.holdT -= dt;
      while (this.holdT <= 0) {
        this.holdT += REPEAT_EVERY;
        this.spin(dir);
      }
    }
  }

  moveSlot(d) {
    sfx('switch');
    this.slot = (this.slot + d + 3) % 3;
  }

  spin(d) {
    const i = (CHARS.indexOf(this.initials[this.slot]) + d + CHARS.length) % CHARS.length;
    this.initials[this.slot] = CHARS[i];
  }

  submit() {
    sfx('button_press');
    this.state = 'sending';
    const entry = {
      name: this.initials.join(''),
      score: this.run.score,
      wave: this.run.wave,
      kills: this.run.kills,
      players: this.run.players,
    };
    submitScore(entry, (ok) => {
      if (!ok) {
        this.message = 'SUBMIT FAILED - LEADERBOARD OFFLINE';
        this.state = 'board';
        return;
      }
      // re-read so the board includes this run, then find its rank
      fetchTop((rows) => {
        if (rows) {
          this.rows = rows;
          const i = rows.findIndex((r) => r.name === entry.name && r.score === entry.score);
          this.rank = i >= 0 ? i + 1 : null;
          if (this.rank === null) this.message = 'BELOW THE GLOBAL TOP 100';
        } else {
          this.message = 'SCORE SAVED - BOARD UNAVAILABLE';
        }
        this.state = 'board';
      });
    });
  }

  updateBoard() {
    for (const port of connectedPorts()) {
      const pad = pollPad(port);
      if (pad.just(Pads.START) || pad.just(Pads.CROSS)) {
        sfx('button_press');
        screens.change('title');
        return;
      }
    }
  }

  render() {
    P('bg').draw(0, 0, { color: Color.new(120, 120, 120, 128) });
    Draw.rect(0, 0, SCREEN_W, SCREEN_H, Color.new(0, 0, 0, 70));

    drawTextCentered(SCREEN_W / 2, 46, 'GAME OVER', { scale: 4, color: RED() });
    const r = this.run;
    drawTextCentered(
      SCREEN_W / 2, 106,
      `SCORE ${String(r.score).padStart(8, '0')}   WAVE ${r.wave}   KILLS ${r.kills}`,
      { color: WHITE() },
    );

    if (this.state === 'entry') this.renderEntry();
    else if (this.state === 'sending') {
      if (Math.floor(this.t * 2) % 2 === 0) {
        drawTextCentered(SCREEN_W / 2, SCREEN_H / 2, 'SENDING SCORE...', { scale: 2, color: YELLOW() });
      }
    } else this.renderBoard();
  }

  renderEntry() {
    drawTextCentered(SCREEN_W / 2, 160, 'ENTER YOUR INITIALS', { scale: 2, color: GREEN() });
    for (let i = 0; i < 3; i++) {
      const x = SCREEN_W / 2 + (i - 1) * 70;
      const focused = i === this.slot;
      // the active slot blinks; its underline caret stays solid
      if (!focused || Math.floor(this.t * 4) % 4 !== 3) {
        drawTextCentered(x, 200, this.initials[i], { scale: 5, color: focused ? YELLOW() : WHITE() });
      }
      if (focused) Draw.rect(x - 22, 300, 44, 4, YELLOW());
    }
    drawTextCentered(SCREEN_W / 2, 340, 'UP/DOWN: LETTER   LEFT/RIGHT: SLOT', { color: DIM(110) });
    drawTextCentered(SCREEN_W / 2, 362, 'START: SUBMIT   CROSS: NEXT', { color: DIM(110) });
  }

  renderBoard() {
    const rows = this.rows;
    if (rows && rows.length > 0) {
      drawTextCentered(SCREEN_W / 2, 148, `GLOBAL TOP ${Math.min(rows.length, LEADERBOARD.top)}`, { scale: 2, color: GREEN() });
      for (let i = 0; i < rows.length && i < LEADERBOARD.top; i++) {
        const row = rows[i];
        const ours = this.rank !== null && i === this.rank - 1;
        const line = `${String(i + 1).padStart(2)}  ${row.name}  ${String(row.score).padStart(8, '0')}  W${String(row.wave).padEnd(3)}`;
        drawTextCentered(SCREEN_W / 2, 178 + i * 18, line, { color: ours ? YELLOW() : WHITE() });
      }
      if (this.rank !== null && this.rank > LEADERBOARD.top) {
        drawTextCentered(SCREEN_W / 2, 178 + LEADERBOARD.top * 18 + 8, `YOUR RANK: #${this.rank}`, { color: YELLOW() });
      }
    } else {
      drawTextCentered(SCREEN_W / 2, 200, 'NO SCORES YET', { scale: 2, color: DIM(110) });
    }
    if (this.message) drawTextCentered(SCREEN_W / 2, 388, this.message, { color: RED() });
    if (Math.floor(this.t * 2) % 2 === 0) {
      drawTextCentered(SCREEN_W / 2, 414, 'PRESS START', { color: GREEN() });
    }
  }
}
