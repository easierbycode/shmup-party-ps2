// touch-controls.ts — the touch half of Twin-Stick mode, and the START button
// that makes it playable.
//
// The shmupX / cmg launcher (github.com/shmupX/shmupX.github.io) runs this
// game in an iframe and offers a "Touch Twin-Stick" toggle in its Guide: the
// left half of the screen drives movement, the right half drives aim. It hands
// the vectors over one of two ways, and which one depends on where the build is
// served from:
//
//   same-origin (the eShop install, /eshop/shmup-party-ps2/…) — the launcher
//     lays its own touch zones over our frame and patches navigator.getGamepads
//     so we read the sticks as an ordinary pad. Its zones cover the whole
//     viewport, so no touch ever reaches this document.
//   cross-origin (a dev server, or the site embedded from elsewhere) — the
//     launcher can't patch us, so it posts { type: 'cmg-twinstick-touch-set',
//     value } and this module provides the zones, the visuals and the vectors
//     itself (the shape shmup-party-phaser4's touch-controls.ts established).
//
// Either way the pad the game ends up reading carries ANALOG STICKS ONLY —
// the launcher's virtual pad reports all sixteen buttons unpressed. A player
// on glass can move and aim and can never press START, which is the one button
// the title screen, a spectator seat, the perk picker and the game-over board
// all wait on. Hence the button below: one START, parked at the top centre of
// the right half — the far corner of the aim thumb's reach — that gets out of
// the way the moment a stick is touched and drifts back a beat after the last
// finger lifts, so it is never on screen during play but always there when the
// game is waiting for it.
//
// In the same-origin case the button has to be mounted into the LAUNCHER's
// document: our own frame sits under its touch zones, where nothing is
// tappable. That is only reachable because the eShop serves us same-origin,
// and it is guarded: we mount only while the launcher's zones are actually up
// (they come down with the Guide, and when the toggle goes off), and we take
// the button back out again when they do.

import { PAD_BUTTONS } from '5velte-ps2'

/** px of travel before our own analogs register — the launcher's dead zone */
const DEAD = 22
/** knob travel limit, matching the launcher's stick radius */
const RADIUS = 60
/** how long after the last touch the START button drifts back in. Short enough
    that lifting both thumbs is a usable "I want the button" gesture mid-run,
    long enough that re-planting a thumb never makes it flash. */
const REVEAL_AFTER_IDLE_MS = 700
/** how often we look for the launcher's touch zones. Short, because the Guide
    opening is one of the things that takes them away and the button should not
    still be sitting over the Guide's first row when it does. */
const ZONE_POLL_MS = 150
/** a stick reading this far off centre counts as "hands on" */
const ACTIVE_AXIS = 0.12
/** frames a tap holds START — one is enough for justPressed(), two is safe */
const START_FRAMES = 2

const BUTTON_ID = 'shmup-touch-start'
const STYLE_ID = 'shmup-touch-start-style'
/** the launcher's own zones; their presence IS "touch twin-stick is on" */
const LAUNCHER_ZONE = '.twin-touch-zone'
/** the launcher's virtual pad, which only exists while a finger is down */
const TOUCH_PAD_RE = /touch twin-?stick/i

type Mode =
  | 'off'
  /** the launcher owns the touches; we only mount the button, in its document */
  | 'launcher'
  /** we own the touches: our own zones, visuals and vectors */
  | 'own'

interface Stick {
  id: number | null
  ox: number
  oy: number
  x: number
  y: number
  base: HTMLElement | null
  knob: HTMLElement | null
}

const newStick = (): Stick => ({ id: null, ox: 0, oy: 0, x: 0, y: 0, base: null, knob: null })

/** does this pad id belong to the launcher's touch stick? */
export function isTouchPadId(id: string | undefined | null): boolean {
  return TOUCH_PAD_RE.test(id || '')
}

export class TouchControls {
  private mode: Mode = 'off'
  private move = newStick()
  private aim = newStick()
  private startFrames = 0
  private button: HTMLButtonElement | null = null
  private buttonShown = false
  private lastActiveAt = 0
  private zoneTimer: ReturnType<typeof setInterval> | undefined
  /** set by ?touch=1 / ?touch=0 — forces our own analogs on or off */
  private readonly forced: boolean | null

  constructor(search = typeof location === 'undefined' ? '' : location.search) {
    this.forced = readForced(search)
    if (typeof window === 'undefined') return

    window.addEventListener('message', this.onMessage)
    window.addEventListener('touchstart', this.onTouchStart, { passive: true })
    window.addEventListener('touchmove', this.onTouchMove, { passive: true })
    window.addEventListener('touchend', this.onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: true })
    // the button can live in the launcher's document, which outlives our frame,
    // so it comes out whenever this one goes away — including into the back/
    // forward cache, which is why it has to be put back on the way in again
    window.addEventListener('pagehide', this.unmountButton)
    window.addEventListener('pageshow', this.remountButton)

    this.advertise()
    // The same-origin launcher never sends cmg-twinstick-touch-set (a game that
    // acted on it would double up its zones), so its toggle is read off the
    // zones it draws instead.
    if (this.launcherDocument()) this.zoneTimer = setInterval(this.pollZones, ZONE_POLL_MS)
    if (this.forced === true) this.setMode('own')
  }

  destroy() {
    if (typeof window === 'undefined') return
    window.removeEventListener('message', this.onMessage)
    window.removeEventListener('touchstart', this.onTouchStart)
    window.removeEventListener('touchmove', this.onTouchMove)
    window.removeEventListener('touchend', this.onTouchEnd)
    window.removeEventListener('touchcancel', this.onTouchEnd)
    window.removeEventListener('pagehide', this.unmountButton)
    window.removeEventListener('pageshow', this.remountButton)
    if (this.zoneTimer !== undefined) clearInterval(this.zoneTimer)
    for (const stick of [this.move, this.aim]) {
      this.releaseStick(stick)
      stick.base?.remove()
      stick.knob?.remove()
      stick.base = null
      stick.knob = null
    }
    this.unmountButton()
  }

  // ── the launcher handshake ────────────────────────────────────────────────

  /** tell a mounting launcher this game wants the Twin-Stick toggle. Harmless
      standalone (no parent listening) and re-sent, because the launcher's own
      listener may not be mounted on our first frame. */
  private advertise() {
    const post = () => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'cmg-twinstick', default: true }, '*')
        }
      } catch {
        /* standalone, or a parent we may not talk to */
      }
    }
    post()
    setTimeout(post, 300)
    setTimeout(post, 1200)
  }

  private onMessage = (e: MessageEvent) => {
    // only the launcher that mounted us gets a say
    if (window.parent === window || (e.source && e.source !== window.parent)) return
    const data = e.data as { type?: string; value?: unknown } | null
    if (!data || data.type !== 'cmg-twinstick-touch-set') return
    if (this.forced !== null) return // ?touch= wins for testing
    this.setMode(data.value ? 'own' : 'off')
  }

  /**
   * Is the frame above us one we may read? Answered WITHOUT touching it:
   * Chrome logs a "Blocked a frame with origin…" console error at the access
   * point even when the SecurityError is caught, which is exactly why the
   * launcher refuses to probe us either (Dashboard.svelte frameIsSameOrigin).
   */
  private sameOriginParent(): boolean {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) return false
    const ancestors = location.ancestorOrigins
    if (ancestors && ancestors.length > 0) return ancestors[0] === location.origin
    return true // no ancestorOrigins (Firefox): the guarded probe below decides
  }

  /** the launcher's document, when it is one we are allowed to read */
  private launcherDocument(): Document | null {
    if (!this.sameOriginParent()) return null
    try {
      const doc = window.parent.document
      return doc && doc.body ? doc : null
    } catch {
      return null // cross-origin launcher — it posts to us instead
    }
  }

  /** are the launcher's touch zones up right now? */
  private zonesUp(): boolean {
    const doc = this.launcherDocument()
    return !!doc && !!doc.querySelector(LAUNCHER_ZONE)
  }

  /**
   * Same-origin launcher: its zones going up and down ARE the toggle.
   *
   * Level-triggered, not edge-triggered. The button lives in a document this
   * frame does not own — the launcher can re-render it out from under us, and a
   * back/forward-cache round trip takes it out on the way — so every tick
   * re-asserts that it is there rather than trusting a past transition.
   */
  private pollZones = () => {
    if (this.forced !== null) return
    const zoned = this.zonesUp()
    if (zoned) {
      this.setMode('launcher')
      this.mountButton()
    } else if (this.mode === 'launcher') {
      this.setMode('off')
    }
  }

  private setMode(mode: Mode) {
    if (this.mode === mode) return
    this.mode = mode
    if (mode === 'off') {
      this.releaseStick(this.move)
      this.releaseStick(this.aim)
      this.unmountButton()
      return
    }
    // a fresh mode starts with the prompt up: nothing has been touched yet
    this.lastActiveAt = 0
    this.mountButton()
  }

  // ── our own analogs (cross-origin launchers only) ─────────────────────────
  //
  // Passive listeners that never preventDefault, so anything else listening in
  // this document keeps working; the dead zone keeps a stray tap from nudging
  // the player.

  private stickFor(clientX: number): Stick {
    return clientX < window.innerWidth / 2 ? this.move : this.aim
  }

  private onTouchStart = (e: TouchEvent) => {
    if (this.mode !== 'own') return
    for (const t of Array.from(e.changedTouches)) {
      if (this.button && t.target instanceof Node && this.button.contains(t.target)) continue
      const s = this.stickFor(t.clientX)
      if (s.id !== null) continue // that half already has a finger down
      this.ensureStickEls(s)
      s.id = t.identifier
      s.ox = t.clientX
      s.oy = t.clientY
      place(s.base, s.ox, s.oy)
      this.dragStick(s, t.clientX, t.clientY)
    }
  }

  private onTouchMove = (e: TouchEvent) => {
    if (this.mode !== 'own') return
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.move.id) this.dragStick(this.move, t.clientX, t.clientY)
      else if (t.identifier === this.aim.id) this.dragStick(this.aim, t.clientX, t.clientY)
    }
  }

  private onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.move.id) this.releaseStick(this.move)
      else if (t.identifier === this.aim.id) this.releaseStick(this.aim)
    }
  }

  private dragStick(s: Stick, cx: number, cy: number) {
    const dx = cx - s.ox
    const dy = cy - s.oy
    const mag = Math.sqrt(dx * dx + dy * dy)

    // the knob follows the finger, pinned to its travel radius
    const k = mag > RADIUS ? RADIUS / mag : 1
    place(s.knob, s.ox + dx * k, s.oy + dy * k)

    if (mag < DEAD) {
      s.x = 0
      s.y = 0
      return
    }
    // ramp from nothing at the dead zone to full deflection at the radius, so
    // there is no step the moment the stick wakes up
    const norm = Math.min(1, (mag - DEAD) / (RADIUS - DEAD))
    s.x = (dx / mag) * norm
    s.y = (dy / mag) * norm
  }

  private releaseStick(s: Stick) {
    if (s.base) s.base.style.display = 'none'
    if (s.knob) s.knob.style.display = 'none'
    s.id = null
    s.x = 0
    s.y = 0
  }

  private ensureStickEls(s: Stick) {
    if (!s.base) s.base = stickEl(RADIUS * 2, false)
    if (!s.knob) s.knob = stickEl(56, true)
  }

  // ── what the pad source reads ─────────────────────────────────────────────

  /** our own analogs, or null when the sticks are somebody else's job */
  axes(): { lx: number; ly: number; rx: number; ry: number } | null {
    if (this.mode !== 'own') return null
    if (this.move.id === null && this.aim.id === null) return null
    return { lx: this.move.x, ly: this.move.y, rx: this.aim.x, ry: this.aim.y }
  }

  /** the PS2 mask this frame. Ages the START pulse, so call it once per frame. */
  buttonMask(): number {
    if (this.startFrames <= 0) return 0
    this.startFrames--
    return PAD_BUTTONS.START
  }

  /**
   * Once per frame, from the pad source: are there hands on the sticks? The
   * button hides while there are and comes back when they have been off for
   * REVEAL_AFTER_IDLE_MS.
   */
  noteActivity(sticksMoving: boolean) {
    if (this.mode === 'off') return
    const active =
      sticksMoving || this.move.id !== null || this.aim.id !== null
    const now = Date.now()
    if (active) this.lastActiveAt = now
    this.showButton(now - this.lastActiveAt >= REVEAL_AFTER_IDLE_MS)
  }

  // ── the START button ──────────────────────────────────────────────────────

  private mountButton() {
    if (typeof document === 'undefined') return
    // Same-origin launcher: its touch zones cover our frame, so the button has
    // to go in ITS document to be tappable at all. Anywhere else it is ours.
    const doc = (this.mode === 'launcher' && this.launcherDocument()) || document
    if (this.button && this.button.isConnected && this.button.ownerDocument === doc) return
    this.unmountButton()
    // a scene restart builds a second TouchControls before the first is torn
    // down; the launcher's document would keep both buttons
    doc.getElementById(BUTTON_ID)?.remove()
    installStyle(doc)
    const el = doc.createElement('button')
    el.id = BUTTON_ID
    el.type = 'button'
    el.className = 'shmup-touch-start is-hidden'
    el.textContent = 'START'
    el.setAttribute('aria-label', 'Start')
    el.addEventListener('pointerdown', this.onButtonPointer)
    el.addEventListener('click', this.onButtonClick)
    doc.body.appendChild(el)
    this.button = el
    this.buttonShown = false
  }

  /** put the button back after a bfcache restore, or after the launcher
      re-rendered it away; a no-op while the mode is off */
  private remountButton = () => {
    if (this.mode !== 'off') this.mountButton()
  }

  private unmountButton = () => {
    const el = this.button
    if (!el) return
    const doc = el.ownerDocument
    el.removeEventListener('pointerdown', this.onButtonPointer)
    el.removeEventListener('click', this.onButtonClick)
    el.remove()
    // the launcher's document outlives this frame: take the stylesheet back
    // out too, so nothing of ours is left behind in it
    if (doc !== document) doc.getElementById(STYLE_ID)?.remove()
    this.button = null
    this.buttonShown = false
  }

  private pointerPressAt = 0

  private onButtonPointer = (e: Event) => {
    // claim the tap before the launcher's zone underneath can read it as a
    // stick, and before it turns into a synthetic click
    e.preventDefault()
    e.stopPropagation()
    this.pointerPressAt = Date.now()
    // The Guide's scrim shares our z-index and wins on document order, so for
    // one poll tick after the Guide opens a tap here would be stolen from it.
    // Re-check the zones on the tap itself rather than living with that window.
    if (this.mode === 'launcher' && !this.zonesUp()) {
      this.pollZones()
      return
    }
    this.press()
    // "hide it after first touch" — a tap on the button is a touch
    this.lastActiveAt = Date.now()
    this.showButton(false)
  }

  /** Keyboards and assistive tech activate a button with click, not
      pointerdown. This path deliberately does NOT hide the button: hiding it
      would blur the element the user is standing on and drop focus to the body. */
  private onButtonClick = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    if (Date.now() - this.pointerPressAt < 500) return // the tap we already took
    this.press()
  }

  private press() {
    this.startFrames = START_FRAMES
  }

  private showButton(show: boolean) {
    const el = this.button
    if (!el || show === this.buttonShown) return
    this.buttonShown = show
    el.classList.toggle('is-hidden', !show)
    el.setAttribute('aria-hidden', show ? 'false' : 'true')
  }
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

function readForced(search: string): boolean | null {
  let forced: string | null = null
  try {
    forced = new URLSearchParams(search).get('touch')
  } catch {
    return null
  }
  if (forced === '1' || forced === 'on') return true
  if (forced === '0' || forced === 'off') return false
  return null
}

function place(el: HTMLElement | null, x: number, y: number) {
  if (!el) return
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  el.style.display = 'block'
}

/** one ring of our own analog stick — the launcher draws its own */
function stickEl(size: number, filled: boolean): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed',
    'display:none',
    'pointer-events:none',
    'z-index:9998',
    `width:${size}px`,
    `height:${size}px`,
    `margin-left:${-size / 2}px`,
    `margin-top:${-size / 2}px`,
    'border-radius:50%',
    filled
      ? 'background:rgba(156,255,107,.35);border:2px solid rgba(156,255,107,.8)'
      : 'background:rgba(156,255,107,.08);border:2px solid rgba(156,255,107,.45)',
    'box-shadow:0 0 14px rgba(156,255,107,.35)',
  ].join(';')
  document.body.appendChild(el)
  return el
}

/**
 * The button's stylesheet, injected into whichever document holds it.
 *
 * Placement: centred on the right half (75% of the viewport) and pinned to the
 * top, which is as far as a button can get from where twin-stick thumbs live.
 * The `right` clamp keeps it clear of the launcher's own top-right corner
 * zone (min(13vmin, 104px) — the two-finger gesture that opens the Guide) on
 * viewports too narrow for 75% to be clear of it by itself.
 *
 * z-index 102 puts it over the launcher's touch zones (101). It ties the
 * Guide's scrim (Osd.svelte's .osd-scrim, also 102) and wins on document order,
 * which is why the button comes down with the zones when the Guide opens — and
 * why onButtonPointer re-checks the zones on the tap itself rather than trusting
 * the poll to have got there first.
 */
function installStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.shmup-touch-start {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  right: max(calc(25% - 58px), calc(min(13vmin, 104px) + 10px));
  z-index: 102;
  min-width: 116px;
  min-height: 48px;
  padding: 0 18px;
  border: 1px solid rgba(156, 255, 107, .75);
  border-radius: 999px;
  background: rgba(6, 10, 6, .72);
  color: #9cff6b;
  font: 700 14px/1 ui-monospace, "Share Tech Mono", SFMono-Regular, Menlo, monospace;
  letter-spacing: 3px;
  text-shadow: 0 1px 2px #000;
  box-shadow: 0 0 14px rgba(156, 255, 107, .25), inset 0 0 12px rgba(156, 255, 107, .08);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  opacity: 1;
  visibility: visible;
  transition: opacity .18s ease, visibility 0s;
  animation: shmup-touch-start-pulse 1.8s ease-in-out infinite;
}
.shmup-touch-start:focus-visible {
  outline: 2px solid #9cff6b;
  outline-offset: 3px;
}
.shmup-touch-start.is-hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  animation: none;
  transition: opacity .18s ease, visibility 0s linear .18s;
}
@keyframes shmup-touch-start-pulse {
  50% { box-shadow: 0 0 22px rgba(156, 255, 107, .5), inset 0 0 12px rgba(156, 255, 107, .14); }
}
@media (prefers-reduced-motion: reduce) {
  /* both selectors: .is-hidden re-declares transition at a higher specificity */
  .shmup-touch-start,
  .shmup-touch-start.is-hidden { animation: none; transition: none; }
}
@media (forced-colors: active) {
  .shmup-touch-start {
    background: ButtonFace;
    color: ButtonText;
    border-color: ButtonBorder;
    box-shadow: none;
  }
}
`
  doc.head.appendChild(style)
}
