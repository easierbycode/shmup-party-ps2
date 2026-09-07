// Sh'M↑ Party — Wave Editor. Authors ps2/data/waves.js for the arena
// (screens/game.js plays it through lib/waves.js): enemies placed on the
// 1280x896 world, wave by wave, drawn with the game's own sheets and the
// stats the game gives them. Plain canvas + DOM — a placement tool needs
// no Phaser, and the CMG Desktop opens this page in a window of its own.
//
// SAVE downloads waves.js (drop it into ps2/data/); LOAD reads one back, or
// a .json of the same array; TEST opens play/?waves=local&wave=<n>&offline=1
// — the browser build on this list, straight at the wave on screen, as a
// local run. Work in progress autosaves to localStorage so a reload costs
// nothing.

import { ENEMIES, VARIANTS } from '../../ps2/data/tuning.js'
import { SHEETS } from '../../ps2/data/sheets.js'
import { WORLD_W, WORLD_H } from '../../ps2/lib/util.js'
import { WAVES_STORAGE_KEY } from '../waves-key.ts'

interface Stats {
  hp: number
  speed: number
  radius: number
  spawn?: unknown
}
interface Variant {
  base: string
  hp: number
  speed: number
  scale?: number
  tint: [number, number, number]
  alpha?: number
  wave?: number
}
interface Sheet {
  count: number
  cols?: number
  fw: number
  fh: number
  file: string
}
/** one enemy as data/waves.js stores it */
interface Placed {
  type: string
  variant?: string
  x: number
  y: number
}
interface Wave {
  boss: boolean
  enemies: Placed[]
}
/** a palette entry: a base type, or a variant of one */
interface Brush {
  key: string
  type: string
  variant?: string
  scale: number
  tint?: [number, number, number]
  alpha?: number
  minWave: number
}

const BASES = ENEMIES as unknown as Record<string, Stats>
const VARS = VARIANTS as unknown as Record<string, Variant>
const META = SHEETS as unknown as Record<string, Sheet>

const BRUSHES: Brush[] = [
  ...Object.keys(BASES).map((type) => ({ key: type, type, scale: 1, minWave: 0 })),
  ...Object.entries(VARS).map(([key, v]) => ({
    key,
    type: v.base,
    variant: key,
    scale: v.scale ?? 1,
    tint: v.tint,
    alpha: v.alpha,
    minWave: v.wave ?? 0,
  })),
]
const isDen = (type: string) => !!BASES[type]?.spawn

type Mode = 'single' | 'line' | 'ring' | 'scatter' | 'edges'
const MODES: Array<[Mode, string, string]> = [
  ['single', 'Single', 'one enemy at the click'],
  ['line', 'Line', '`count` in a row, `spacing` apart, centred on the click'],
  ['ring', 'Ring', '`count` around the click at `radius`'],
  ['scatter', 'Scatter', '`count` at random within `spread` of the click'],
  ['edges', 'Edges', '`count` at random spots just off the world edges'],
]

// how far past the world an enemy may be placed — off-screen, walking in
const MARGIN = 96
const SPAN_W = WORLD_W + 2 * MARGIN
const SPAN_H = WORLD_H + 2 * MARGIN
const GRID = 64
const AUTOSAVE_KEY = 'shmup-party-ps2:wave-editor'
const FLOOR = 'assets/terrain_survival_0.png'

// ── assets ───────────────────────────────────────────────────────────────────

const urls = import.meta.glob('../../ps2/assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const images = new Map<string, HTMLImageElement>()

function loadImage(file: string): Promise<void> {
  const name = file.split('/').pop()!
  const hit = Object.entries(urls).find(([path]) => path.endsWith('/' + name))
  if (!hit) return Promise.resolve()
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      images.set(file, img)
      resolve()
    }
    img.onerror = () => resolve()
    img.src = hit[1]
  })
}

// frame 0 of a brush's sheet, tinted the way the game tints the variant.
// Athena's colour word multiplies by channel/128 (so a variant tint can
// brighten); canvas 'multiply' can only darken, so the tint is normalised to
// its brightest channel — the hue is right, which is what tells variants
// apart on the board.
const frames = new Map<string, HTMLCanvasElement>()
function frameOf(brush: Brush): HTMLCanvasElement | null {
  const cached = frames.get(brush.key)
  if (cached) return cached
  const meta = META[brush.type]
  const img = meta && images.get(meta.file)
  if (!img) return null
  const c = document.createElement('canvas')
  c.width = meta.fw
  c.height = meta.fh
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, meta.fw, meta.fh, 0, 0, meta.fw, meta.fh)
  if (brush.tint) {
    const peak = Math.max(...brush.tint, 1)
    const [r, g, b] = brush.tint.map((v) => Math.round((v / peak) * 255))
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, 0, meta.fw, meta.fh)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(img, 0, 0, meta.fw, meta.fh, 0, 0, meta.fw, meta.fh)
  }
  frames.set(brush.key, c)
  return c
}

// ── state ────────────────────────────────────────────────────────────────────

let waves: Wave[] = [{ boss: false, enemies: [] }]
let cur = 0
let brush = BRUSHES[0]
let mode: Mode = 'single'
let selected = -1
let showGrid = true
let history: string[] = []
let future: string[] = []

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('canvas')
const ctx = canvas.getContext('2d')!
const stage = $('stage')

const view = { scale: 1, ox: 0, oy: 0 }
const toScreen = (wx: number, wy: number) => ({
  x: (wx + MARGIN) * view.scale + view.ox,
  y: (wy + MARGIN) * view.scale + view.oy,
})
const toWorld = (sx: number, sy: number) => ({
  x: (sx - view.ox) / view.scale - MARGIN,
  y: (sy - view.oy) / view.scale - MARGIN,
})
const clampWorld = (v: number, max: number) => Math.round(Math.max(-MARGIN, Math.min(max + MARGIN, v)))

const wave = () => waves[cur]
const brushOf = (e: Placed) => BRUSHES.find((b) => b.key === (e.variant ?? e.type)) ?? BRUSHES[0]

// ── undo / autosave ──────────────────────────────────────────────────────────

function snapshot() {
  history.push(JSON.stringify(waves))
  if (history.length > 100) history.shift()
  future = []
}
function undo() {
  const prev = history.pop()
  if (prev === undefined) return
  future.push(JSON.stringify(waves))
  waves = JSON.parse(prev)
  cur = Math.min(cur, waves.length - 1)
  selected = -1
  changed()
}
function redo() {
  const next = future.pop()
  if (next === undefined) return
  history.push(JSON.stringify(waves))
  waves = JSON.parse(next)
  cur = Math.min(cur, waves.length - 1)
  selected = -1
  changed()
}

let autosaveTimer = 0
function changed() {
  render()
  renderPanel()
  clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ waves, cur }))
    } catch {
      /* private mode, full — the download is the real save */
    }
  }, 300)
}
function restore() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    const list = normalizeWaves(saved.waves)
    if (list.waves.length) {
      waves = list.waves
      cur = Math.min(Number(saved.cur) || 0, waves.length - 1)
    }
  } catch {
    /* start clean */
  }
}

// ── the wave list as data/waves.js holds it ──────────────────────────────────

/** what SAVE writes: boss waves carry only the flag, spots are integers */
function exportWaves(): Array<Record<string, unknown>> {
  return waves.map((w) =>
    w.boss ? { boss: true } : {
      enemies: w.enemies.map((e) => ({
        type: e.type,
        ...(e.variant ? { variant: e.variant } : {}),
        x: Math.round(e.x),
        y: Math.round(e.y),
      })),
    }
  )
}

function wavesSource(): string {
  const rows = exportWaves().map((w) => {
    if (w.boss) return '  { "boss": true },'
    const enemies = (w.enemies as Placed[]).map((e) => '    ' + JSON.stringify(e) + ',').join('\n')
    return '  {\n    "enemies": [\n' + enemies.replace(/^/gm, '  ') + '\n    ],\n  },'
  })
  return [
    '// GENERATED by the Wave Editor (wave-editor/) — drop into ps2/data/waves.js.',
    '// Wave n plays WAVES[n - 1] as written; past the list the procedural',
    '// waves of lib/enemies.js take over. Each enemy: type (an ENEMIES key),',
    '// optional variant (a VARIANTS key), and its world spot — the world is',
    `// ${WORLD_W}x${WORLD_H}; a spot outside it walks in from there. Dens and`,
    '// nests land at wave start, the rest trickle in at the game\'s pace.',
    '// Blank stats take the wave\'s scaling; see the shipped file for hp,',
    '// speed and edge.',
    'export const WAVES = [',
    ...rows,
    '];',
    '',
  ].join('\n')
}

/** anything LOAD may be handed → editable waves. Edge spawns with no spot
    get one just off their edge so they can be seen and moved. */
function normalizeWaves(raw: unknown): { waves: Wave[]; pinned: number; dropped: number } {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray((raw as { waves?: unknown }).waves)
    ? (raw as { waves: unknown[] }).waves
    : []
  let pinned = 0
  let dropped = 0
  const out: Wave[] = []
  for (const w of list) {
    if (!w || typeof w !== 'object') continue
    const rec = w as { boss?: unknown; enemies?: unknown }
    const enemies: Placed[] = []
    for (const e of Array.isArray(rec.enemies) ? rec.enemies : []) {
      const a = e as { type?: unknown; variant?: unknown; x?: unknown; y?: unknown; edge?: unknown }
      const type = String(a.type ?? '')
      if (!BASES[type]) {
        dropped++
        continue
      }
      const variant = typeof a.variant === 'string' && VARS[a.variant]?.base === type ? a.variant : undefined
      let x = typeof a.x === 'number' ? a.x : NaN
      let y = typeof a.y === 'number' ? a.y : NaN
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const spot = edgeSpot(typeof a.edge === 'number' ? a.edge : Math.floor(Math.random() * 4))
        x = spot.x
        y = spot.y
        pinned++
      }
      enemies.push({ type, ...(variant ? { variant } : {}), x: clampWorld(x, WORLD_W), y: clampWorld(y, WORLD_H) })
    }
    out.push({ boss: !!rec.boss, enemies })
  }
  return { waves: out, pinned, dropped }
}

function parseWavesText(text: string): unknown {
  const trimmed = text.trim()
  const m = trimmed.match(/export\s+const\s+WAVES\s*=\s*(\[[\s\S]*\])/)
  const body = m ? m[1] : trimmed
  // the editor writes JSON-with-trailing-commas inside a JS module; JSON
  // proper can't take the commas, so strip them (strings never hold ",]")
  return JSON.parse(body.replace(/,(\s*[\]}])/g, '$1'))
}

// a random spot in the off-world band along edge 0..3 (top/bottom/left/right)
function edgeSpot(edge: number) {
  const r = (a: number, b: number) => a + Math.random() * (b - a)
  if (edge === 0) return { x: r(20, WORLD_W - 20), y: r(-MARGIN + 16, -24) }
  if (edge === 1) return { x: r(20, WORLD_W - 20), y: r(WORLD_H + 24, WORLD_H + MARGIN - 16) }
  if (edge === 2) return { x: r(-MARGIN + 16, -24), y: r(20, WORLD_H - 20) }
  return { x: r(WORLD_W + 24, WORLD_W + MARGIN - 16), y: r(20, WORLD_H - 20) }
}

// ── editing ──────────────────────────────────────────────────────────────────

function place(wx: number, wy: number) {
  if (wave().boss) {
    toast('a boss wave has no enemies — toggle BOSS off to place')
    return
  }
  const num = (id: string, fallback: number) => Math.max(1, Number($<HTMLInputElement>(id).value) || fallback)
  const spots: Array<{ x: number; y: number }> = []
  const count = num('count', 5)
  if (mode === 'single') spots.push({ x: wx, y: wy })
  else if (mode === 'line') {
    const spacing = num('spacing', 48)
    for (let i = 0; i < count; i++) spots.push({ x: wx + (i - (count - 1) / 2) * spacing, y: wy })
  } else if (mode === 'ring') {
    const radius = num('radius', 120)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      spots.push({ x: wx + Math.cos(a) * radius, y: wy + Math.sin(a) * radius })
    }
  } else if (mode === 'scatter') {
    const spread = num('spread', 160)
    for (let i = 0; i < count; i++) {
      spots.push({ x: wx + (Math.random() * 2 - 1) * spread, y: wy + (Math.random() * 2 - 1) * spread })
    }
  } else {
    for (let i = 0; i < count; i++) spots.push(edgeSpot(Math.floor(Math.random() * 4)))
  }
  snapshot()
  for (const s of spots) {
    wave().enemies.push({
      type: brush.type,
      ...(brush.variant ? { variant: brush.variant } : {}),
      x: clampWorld(s.x, WORLD_W),
      y: clampWorld(s.y, WORLD_H),
    })
  }
  selected = wave().enemies.length - 1
  changed()
}

/** the enemy under a world point, topmost first */
function hitTest(wx: number, wy: number): number {
  const list = wave().enemies
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    const b = brushOf(e)
    const meta = META[e.type]
    const r = Math.max(18, ((meta?.fw ?? 36) * b.scale) / 2)
    const dx = e.x - wx
    const dy = e.y - wy
    if (dx * dx + dy * dy <= r * r) return i
  }
  return -1
}

function removeEnemy(i: number) {
  if (i < 0) return
  snapshot()
  wave().enemies.splice(i, 1)
  selected = -1
  changed()
}

function addWave(copy = false) {
  snapshot()
  const src = wave()
  waves.splice(cur + 1, 0, copy ? JSON.parse(JSON.stringify(src)) : { boss: false, enemies: [] })
  cur++
  selected = -1
  changed()
}
function removeWave() {
  snapshot()
  waves.splice(cur, 1)
  if (!waves.length) waves.push({ boss: false, enemies: [] })
  cur = Math.min(cur, waves.length - 1)
  selected = -1
  changed()
}
function clearWave() {
  if (!wave().enemies.length) return
  snapshot()
  wave().enemies = []
  selected = -1
  changed()
}
function toggleBoss() {
  snapshot()
  wave().boss = !wave().boss
  selected = -1
  changed()
}
function gotoWave(i: number) {
  if (i < 0 || i >= waves.length) return
  cur = i
  selected = -1
  changed()
}

// ── files ────────────────────────────────────────────────────────────────────

function saveFile() {
  const empty = waves.filter((w) => !w.boss && !w.enemies.length).length
  const blob = new Blob([wavesSource()], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'waves.js'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast('waves.js downloaded — copy it to ps2/data/waves.js' + (empty ? `\n(${empty} empty wave${empty > 1 ? 's' : ''} will be skipped by the game)` : ''))
}

async function copySource() {
  try {
    await navigator.clipboard.writeText(wavesSource())
    toast('waves.js copied to the clipboard')
  } catch {
    toast('the clipboard is not available here — use SAVE')
  }
}

function loadFile(file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = parseWavesText(String(reader.result))
      const got = normalizeWaves(parsed)
      if (!got.waves.length) throw new Error('no waves in it')
      snapshot()
      waves = got.waves
      cur = 0
      selected = -1
      changed()
      const notes = []
      if (got.pinned) notes.push(`${got.pinned} edge spawn${got.pinned > 1 ? 's' : ''} pinned to a spot off its edge`)
      if (got.dropped) notes.push(`${got.dropped} unknown enem${got.dropped > 1 ? 'ies' : 'y'} dropped`)
      toast(`loaded ${waves.length} wave${waves.length > 1 ? 's' : ''} from ${file.name}` + (notes.length ? '\n' + notes.join(', ') : ''))
    } catch (e) {
      toast(`could not read ${file.name}: ${(e as Error).message}\n(a hand-written waves.js needs quoted keys, or save it as .json)`)
    }
  }
  reader.readAsText(file)
}

function test() {
  try {
    localStorage.setItem(WAVES_STORAGE_KEY, JSON.stringify(exportWaves()))
  } catch {
    toast('localStorage is not available here, so the play page cannot pick the list up')
    return
  }
  const url = new URL('../play/', location.href)
  url.searchParams.set('waves', 'local')
  if (cur > 0) url.searchParams.set('wave', String(cur + 1))
  // a local run: with the lobby on, START would join a live arena instead
  url.searchParams.set('offline', '1')
  const win = window.open(url.href, 'shmup-party-ps2-test')
  if (!win) toast('the browser blocked the play window — allow pop-ups for this page')
  else toast(`testing from wave ${cur + 1} in the play tab`)
}

// ── drawing ──────────────────────────────────────────────────────────────────

function fit() {
  const dpr = window.devicePixelRatio || 1
  const w = stage.clientWidth
  const h = stage.clientHeight
  canvas.width = Math.max(1, Math.round(w * dpr))
  canvas.height = Math.max(1, Math.round(h * dpr))
  view.scale = Math.min(w / SPAN_W, h / SPAN_H)
  view.ox = (w - SPAN_W * view.scale) / 2
  view.oy = (h - SPAN_H * view.scale) / 2
  render()
}

function render() {
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false

  const s = view.scale
  const o = toScreen(-MARGIN, -MARGIN)
  // the off-world band
  ctx.fillStyle = '#0a0f0a'
  ctx.fillRect(o.x, o.y, SPAN_W * s, SPAN_H * s)

  // the floor: the 640x448 terrain mirror-tiled 2x2, as screens/game.js draws it
  const floor = images.get(FLOOR)
  const w0 = toScreen(0, 0)
  if (floor) {
    const tw = (WORLD_W / 2) * s
    const th = (WORLD_H / 2) * s
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        ctx.save()
        ctx.translate(w0.x + tx * tw + (tx ? tw : 0), w0.y + ty * th + (ty ? th : 0))
        ctx.scale(tx ? -1 : 1, ty ? -1 : 1)
        ctx.drawImage(floor, 0, 0, tw, th)
        ctx.restore()
      }
    }
  } else {
    ctx.fillStyle = '#25331c'
    ctx.fillRect(w0.x, w0.y, WORLD_W * s, WORLD_H * s)
  }

  if (showGrid) {
    ctx.strokeStyle = 'rgba(156,255,107,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = GRID; x < WORLD_W; x += GRID) {
      const p = toScreen(x, 0)
      ctx.moveTo(p.x, w0.y)
      ctx.lineTo(p.x, w0.y + WORLD_H * s)
    }
    for (let y = GRID; y < WORLD_H; y += GRID) {
      const p = toScreen(0, y)
      ctx.moveTo(w0.x, p.y)
      ctx.lineTo(w0.x + WORLD_W * s, p.y)
    }
    ctx.stroke()
  }

  // the world frame
  ctx.setLineDash([8, 6])
  ctx.strokeStyle = 'rgba(246,255,74,0.7)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(w0.x, w0.y, WORLD_W * s, WORLD_H * s)
  ctx.setLineDash([])

  // where the players start (screens/game.js makePlayer)
  ctx.font = `${Math.max(9, 11 * s)}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  for (let i = 0; i < 4; i++) {
    const p = toScreen(WORLD_W / 2 + (i % 2 === 0 ? -60 : 60), WORLD_H / 2 + (i < 2 ? -40 : 40))
    ctx.strokeStyle = 'rgba(156,255,107,0.8)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 10 * s, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(156,255,107,0.9)'
    ctx.fillText(`P${i + 1}`, p.x, p.y - 12 * s)
  }

  const cw = wave()
  if (cw.boss) {
    drawBoss(s)
  } else {
    cw.enemies.forEach((e, i) => drawEnemy(e, i === selected, s))
  }

  // captions
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(220,255,180,0.5)'
  ctx.font = `${Math.max(9, 11 * s)}px ui-monospace, monospace`
  ctx.fillText(`WAVE ${cur + 1}${cw.boss ? ' · EVIL BRAIN' : ` · ${cw.enemies.length} enemies`}`, w0.x + 6, w0.y - 6)
  ctx.textAlign = 'right'
  ctx.fillText('off-world band: walks in from here', w0.x + WORLD_W * s - 6, o.y + SPAN_H * s - 6)
}

function drawEnemy(e: Placed, sel: boolean, s: number) {
  const b = brushOf(e)
  const frame = frameOf(b)
  const meta = META[e.type]
  const p = toScreen(e.x, e.y)
  const w = (meta?.fw ?? 36) * b.scale * s
  const h = (meta?.fh ?? 36) * b.scale * s
  if (frame) {
    ctx.globalAlpha = b.alpha !== undefined ? Math.max(0.3, b.alpha / 128) : 1
    ctx.drawImage(frame, p.x - w / 2, p.y - h / 2, w, h)
    ctx.globalAlpha = 1
  } else {
    ctx.fillStyle = '#ff5a5a'
    ctx.fillRect(p.x - 6, p.y - 6, 12, 12)
  }
  if (isDen(e.type)) {
    ctx.strokeStyle = 'rgba(255,214,120,0.6)'
    ctx.setLineDash([3, 3])
    ctx.strokeRect(p.x - w / 2, p.y - h / 2, w, h)
    ctx.setLineDash([])
  }
  if (sel) {
    ctx.strokeStyle = '#9cff6b'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(w, h) / 2 + 4, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1
  }
}

function drawBoss(s: number) {
  const top = META['brain-top']
  const bottom = META['brain-bottom']
  const it = top && images.get(top.file)
  const ib = bottom && images.get(bottom.file)
  const c = toScreen(WORLD_W / 2, 200)
  const k = 3 * s
  if (it && ib) {
    ctx.drawImage(it, 0, 0, top.fw, top.fh, c.x - (top.fw * k) / 2, c.y - top.fh * k, top.fw * k, top.fh * k)
    ctx.drawImage(ib, 0, 0, bottom.fw, bottom.fh, c.x - (bottom.fw * k) / 2, c.y, bottom.fw * k, bottom.fh * k)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ff5a5a'
  ctx.font = `${Math.max(12, 22 * s)}px ui-monospace, monospace`
  ctx.fillText('BOSS WAVE — THE EVIL BRAIN', c.x, c.y + 120 * s)
}

// ── panel ────────────────────────────────────────────────────────────────────

function statsFor(b: Brush, n: number) {
  const base = b.variant ? VARS[b.variant] : BASES[b.type]
  const hpScale = 1 + 0.08 * (n - 1)
  return { hp: Math.round(base.hp * hpScale), speed: base.speed + 3 * n }
}

function buildPalette() {
  const el = $('palette')
  el.textContent = ''
  BRUSHES.forEach((b, i) => {
    const btn = document.createElement('button')
    btn.dataset.key = b.key
    const thumb = document.createElement('canvas')
    thumb.width = 40
    thumb.height = 40
    const frame = frameOf(b)
    if (frame) {
      const tctx = thumb.getContext('2d')!
      tctx.imageSmoothingEnabled = false
      const k = Math.min(40 / frame.width, 40 / frame.height)
      const w = frame.width * k
      const h = frame.height * k
      tctx.globalAlpha = b.alpha !== undefined ? Math.max(0.3, b.alpha / 128) : 1
      tctx.drawImage(frame, (40 - w) / 2, (40 - h) / 2, w, h)
    }
    const label = document.createElement('span')
    label.textContent = b.key
    btn.append(thumb, label)
    btn.addEventListener('click', () => pickBrush(b))
    if (i < 9) btn.title = `${b.key} (${i + 1})`
    el.appendChild(btn)
  })
}

function pickBrush(b: Brush) {
  brush = b
  renderPanel()
}

function buildModes() {
  const el = $('modes')
  el.textContent = ''
  for (const [id, label, tip] of MODES) {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.title = tip
    btn.dataset.mode = id
    btn.addEventListener('click', () => {
      mode = id
      renderPanel()
    })
    el.appendChild(btn)
  }
}

function renderPanel() {
  const n = cur + 1
  $('wave-label').textContent = `WAVE ${n} / ${waves.length}`
  $('boss').classList.toggle('on', wave().boss)
  $('grid').classList.toggle('on', showGrid)
  ;($('undo') as HTMLButtonElement).disabled = !history.length
  ;($('redo') as HTMLButtonElement).disabled = !future.length

  for (const btn of $('palette').querySelectorAll<HTMLButtonElement>('button')) {
    const b = BRUSHES.find((x) => x.key === btn.dataset.key)!
    btn.classList.toggle('on', b.key === brush.key)
    const st = statsFor(b, n)
    btn.title = `${b.key} — hp ${st.hp}, speed ${st.speed} on wave ${n}` +
      (b.minWave > n ? ` (the procedural game holds it back until wave ${b.minWave})` : '') +
      (isDen(b.type) ? ' — lands at wave start and hatches brood' : '')
  }
  for (const btn of $('modes').querySelectorAll<HTMLButtonElement>('button')) {
    btn.classList.toggle('on', btn.dataset.mode === mode)
  }

  const counts = new Map<string, number>()
  for (const e of wave().enemies) counts.set(e.variant ?? e.type, (counts.get(e.variant ?? e.type) ?? 0) + 1)
  const summary = $('summary')
  if (wave().boss) summary.innerHTML = '<b>the Evil Brain</b> — nothing else spawns on a boss wave'
  else if (!counts.size) summary.textContent = 'empty — click the board to place'
  else {
    summary.innerHTML = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `<b>${c}</b> × ${k}`)
      .join(' · ')
  }

  const strip = $('waves')
  strip.textContent = ''
  waves.forEach((w, i) => {
    const btn = document.createElement('button')
    btn.textContent = w.boss ? `${i + 1} · BOSS` : `${i + 1} · ${w.enemies.length}`
    btn.classList.toggle('boss', w.boss)
    btn.classList.toggle('on', i === cur)
    btn.addEventListener('click', () => gotoWave(i))
    strip.appendChild(btn)
  })

  const st = statsFor(brush, n)
  $('brush-status').innerHTML = `brush <b>${brush.key}</b> · ${mode} · hp ${st.hp} · speed ${st.speed}`
}

let toastTimer = 0
function toast(text: string) {
  const el = $('toast')
  el.textContent = text
  el.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('on'), 3200)
}

// ── input ────────────────────────────────────────────────────────────────────

let drag: { index: number; dx: number; dy: number; moved: boolean; snapped: boolean } | null = null

function pointerWorld(ev: PointerEvent) {
  const r = canvas.getBoundingClientRect()
  return toWorld(ev.clientX - r.left, ev.clientY - r.top)
}

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault())

canvas.addEventListener('pointerdown', (ev) => {
  const p = pointerWorld(ev)
  const hit = wave().boss ? -1 : hitTest(p.x, p.y)
  if (ev.button === 2) {
    if (hit >= 0) removeEnemy(hit)
    return
  }
  if (ev.button !== 0) return
  if (hit >= 0) {
    selected = hit
    const e = wave().enemies[hit]
    drag = { index: hit, dx: e.x - p.x, dy: e.y - p.y, moved: false, snapped: false }
    canvas.setPointerCapture(ev.pointerId)
    render()
    return
  }
  place(p.x, p.y)
})

canvas.addEventListener('pointermove', (ev) => {
  const p = pointerWorld(ev)
  $('pos').textContent = `${Math.round(p.x)}, ${Math.round(p.y)}` +
    (p.x < 0 || p.y < 0 || p.x > WORLD_W || p.y > WORLD_H ? ' (off-world)' : '')
  if (!drag) return
  if (!drag.snapped) {
    snapshot()
    drag.snapped = true
  }
  const e = wave().enemies[drag.index]
  if (!e) return
  e.x = clampWorld(p.x + drag.dx, WORLD_W)
  e.y = clampWorld(p.y + drag.dy, WORLD_H)
  drag.moved = true
  render()
})

function endDrag(ev: PointerEvent) {
  if (!drag) return
  try {
    canvas.releasePointerCapture(ev.pointerId)
  } catch {
    /* already released */
  }
  const moved = drag.moved
  drag = null
  if (moved) changed()
}
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)

window.addEventListener('keydown', (ev) => {
  const target = ev.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  const key = ev.key.toLowerCase()
  if ((ev.ctrlKey || ev.metaKey) && key === 'z') {
    ev.preventDefault()
    if (ev.shiftKey) redo()
    else undo()
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && key === 'y') {
    ev.preventDefault()
    redo()
    return
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return
  if (ev.key === 'ArrowLeft') gotoWave(cur - 1)
  else if (ev.key === 'ArrowRight') gotoWave(cur + 1)
  else if (key === 'n') addWave()
  else if (key === 'b') toggleBoss()
  else if (key === 'g') {
    showGrid = !showGrid
    changed()
  } else if (key === 's') {
    ev.preventDefault()
    saveFile()
  } else if (key === 'l') $<HTMLInputElement>('load').click()
  else if (key === 't') test()
  else if (key === 'h') $('help').hidden = !$('help').hidden
  else if (ev.key === 'Escape') {
    selected = -1
    $('help').hidden = true
    render()
  } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault()
    if (selected >= 0) removeEnemy(selected)
    else clearWave()
  } else if (/^[1-9]$/.test(ev.key)) {
    const b = BRUSHES[Number(ev.key) - 1]
    if (b) pickBrush(b)
  } else return
})

$('prev').addEventListener('click', () => gotoWave(cur - 1))
$('next').addEventListener('click', () => gotoWave(cur + 1))
$('new').addEventListener('click', () => addWave())
$('dup').addEventListener('click', () => addWave(true))
$('boss').addEventListener('click', toggleBoss)
$('clear').addEventListener('click', clearWave)
$('del').addEventListener('click', removeWave)
$('undo').addEventListener('click', undo)
$('redo').addEventListener('click', redo)
$('grid').addEventListener('click', () => {
  showGrid = !showGrid
  changed()
})
$('save').addEventListener('click', saveFile)
$('copy').addEventListener('click', copySource)
$('test').addEventListener('click', test)
$('help-btn').addEventListener('click', () => {
  $('help').hidden = !$('help').hidden
})
$<HTMLInputElement>('load').addEventListener('change', (ev) => {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) loadFile(file)
  input.value = ''
})
for (const id of ['count', 'spacing', 'radius', 'spread']) {
  $<HTMLInputElement>(id).addEventListener('change', renderPanel)
}

// ── boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  const files = new Set<string>([FLOOR, META['brain-top'].file, META['brain-bottom'].file])
  for (const b of BRUSHES) files.add(META[b.type].file)
  await Promise.all([...files].map(loadImage))
  restore()
  buildPalette()
  buildModes()
  new ResizeObserver(fit).observe(stage)
  fit()
  renderPanel()
  if (!localStorage.getItem(AUTOSAVE_KEY)) $('help').hidden = false
}

boot()
