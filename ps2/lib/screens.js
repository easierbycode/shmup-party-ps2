// Minimal screen manager (title <-> game). Screens implement
// update(dt), render(), and optionally onEnter/onExit.

import { dtSeconds } from 'lib/clock.js';

class ScreenManager {
  constructor() {
    this.registry = new Map();
    this.current = null;
  }

  register(id, screen) {
    this.registry.set(id, screen);
  }

  change(id) {
    if (this.current && this.current.onExit) this.current.onExit();
    this.current = this.registry.get(id);
    if (this.current && this.current.onEnter) this.current.onEnter();
  }

  /** one frame: called from inside Screen.display() */
  tick() {
    const dt = dtSeconds();
    if (!this.current) return;
    this.current.update(dt);
    this.current.render();
  }
}

export const screens = new ScreenManager();
