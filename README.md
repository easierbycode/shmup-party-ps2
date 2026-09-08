# Sh'M↑ Party — PlayStation 2

![Sh'M↑ Party — level-up perk screen](docs/preview.png)

Twin-stick survival shooter, ported from
[shmup-party-sp](https://github.com/easierbycode/shmup-party-sp) (Svelte 5 +
Phaser 4) to [5velte-ps2](https://github.com/easierbycode/svelte-ps2) — the
AthenaEnv v4 compatibility layer. **One JS codebase, three targets:**

- **Real PS2 / PCSX2 / Play!** — [`ps2/`](ps2/) is a complete
  [AthenaEnv](https://github.com/DanielSant0s/AthenaEnv) app (athena.elf +
  `main.js` + assets) packaged into a bootable ISO9660 image.
- **Browser** — the same `ps2/` modules run unmodified on Phaser 4 via
  5velte-ps2's host: [`src/web/ps2-scene.ts`](src/web/ps2-scene.ts) installs
  AthenaEnv's globals (`Screen`, `Draw`, `Image`, `Pads`, …), imports
  `ps2/main.js`, and ticks the runtime every frame.
- **Nintendo Switch (homebrew)** — the same modules a third time, on
  [quickjs-ng](https://github.com/quickjs-ng/quickjs) + SDL2 via the native
  host in [`switch/`](switch/): ~1.5k lines of C (devkitPro/libnx) implement
  the same globals and evaluate `ps2/main.js` out of romfs, producing a
  `.nro` for hbmenu on CFW (Atmosphère). See
  [Nintendo Switch build](#nintendo-switch-build).

Download page + browser build + ISO deploy to
**<https://easierbycode.com/shmup-party-ps2/>** on every push to `main`
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)), with the
[Wave Editor](#wave-editor) at `/wave-editor/` and a launcher zip of the
browser build (`shmup-party-ps2-web.zip`, see [Launchers](#launchers))
beside them.

## Run

```sh
npm install
npm run dev        # browser build at http://localhost:5173/play/
npm run build      # production build (base /shmup-party-ps2/)
npm run iso        # deno-powered ISO9660 writer -> shmup-party-ps2.iso
npm run nro        # Switch homebrew build -> switch/shmup-party.nro
npm run launcher-zip  # the browser build at a relative base path, zipped for launchers
npm run assets     # regenerate ps2/assets from ../shmup-party-sp art + sfx (PIL, ffmpeg)
```

The ISO boots in PCSX2, in the CMG launcher's PlayStation 2 screen (the
Play! WASM emulator), and on softmodded hardware (OPL / DVD-R).

## Launchers

The Pages build is rooted at `/shmup-party-ps2/` (every asset URL in it is
absolute), so a launcher cannot unpack it under a folder of its own.
[`scripts/build-launcher-zip.ts`](scripts/build-launcher-zip.ts) — `npm run
launcher-zip`, and a step of the deploy — builds the browser game once more
with `BASE_PATH=./` (every URL relative to its own files, so it runs from any
mount point) and zips `play/` + `assets/` into `dist/shmup-party-ps2-web.zip`.
The deploy publishes that beside the site at
<https://easierbycode.com/shmup-party-ps2/shmup-party-ps2-web.zip>, which is
what the [shmupX launcher](https://github.com/easierbycode/shmupX.github.io)'s
eShop installs (entry `play/index.html`, served from `/eshop/shmup-party-ps2/`
by its service worker): the same commit, the same build the site's PLAY IN
BROWSER runs. The zip is written by a small pure-Deno zip writer — nothing
to install on the runner.

[`codemonkey.json`](codemonkey.json) at the repo root is what the game says
about itself to a launcher (the cmg launcher's convention): its **release
status** — `EARLY_ACCESS` today — which the shmupX eShop reads off `main`
for the catalog row and its filter, and again from the zip's root (the
script packs the file) when the game is installed. Set it to `RELEASED`
(or drop the field) when the port leaves early access.

## Wave Editor

<https://easierbycode.com/shmup-party-ps2/wave-editor/> (`/wave-editor/` on
the dev server; also in the CMG Desktop's Tools folder) authors
[`ps2/data/waves.js`](ps2/data/waves.js): enemies placed on the 1280x896
world, wave by wave, drawn with the game's own sheets — every base type and
every Crimsonland variant from `data/tuning.js` is a brush, tinted the way the
game tints it, with the hp and speed the current wave would give it in the
tooltip. Placement modes drop one enemy, a line, a ring, a scatter, or a
handful of random off-world edge spots; enemies drag, right-click deletes,
a wave can be marked as the Evil Brain, and there is undo, a 64px grid and
autosave. It is a port of shmup-party-phaser4's `wave-editor.html` to this
port's arena, roster and file format.

The arena ([`ps2/screens/game.js`](ps2/screens/game.js), through
[`ps2/lib/waves.js`](ps2/lib/waves.js)) plays wave *n* as `WAVES[n - 1]`
exactly as written — dens and nests land at their spots at wave start, the
rest trickle in from theirs at the usual pace, blank stats take the wave's
scaling, `boss: true` is the Evil Brain — and past the end of the list the
procedural waves of `lib/enemies.js` (and their every-fifth-wave boss) take
over, so the shipped empty list is the game as before. **SAVE** downloads
`waves.js` to drop into `ps2/data/` (the ISO, the NRO and the web build all
bake it in), **LOAD** reads one back, and **TEST** opens
`play/?waves=local&wave=<n>&offline=1` — the browser build on the list being
edited, straight at the wave on screen, as a local run (without `offline`,
START joins whatever arena the lobby says is live). Those query strings are
read by [`src/web/waves-param.ts`](src/web/waves-param.ts) on the play page
only; `?waves=` also takes a base64url JSON list inline. Real hardware sees
the baked file and nothing else.

## Nintendo Switch build

`npm run nro` stages `ps2/` into `switch/romfs/`
([`scripts/stage-switch-romfs.mjs`](scripts/stage-switch-romfs.mjs) — JS +
PNGs + the `.wav` sfx twins) and compiles the host, trying in order: a
`DEVKITPRO` env with `make` on PATH, an MSYS2 install with the devkitPro
pacman packages at `C:\msys64` (`pacman -S pkgconf switch-dev switch-sdl2
switch-sdl2_image switch-sdl2_mixer` after adding the
[devkitPro repos](https://devkitpro.org/wiki/devkitPro_pacman)), then Docker
(`devkitpro/devkita64` + portlibs,
[`switch/builder.Dockerfile`](switch/builder.Dockerfile), cached after the
first run). Clone with `--recurse-submodules` — quickjs-ng is vendored at
`switch/vendor/quickjs`.

Dev loop against real hardware: hbmenu → **Y** (netloader), then

```sh
nxlink -s switch/shmup-party.nro
```

streams stdout — including JS stack traces — back over WiFi. For a
PC-free install copy the NRO to `sd:/switch/shmup-party.nro`.

Switch specifics: buttons map by **position** (bottom face button = CROSS =
fire/confirm, ZR also fires), up to four controllers hot-join like the other
targets, rumble works, and the leaderboard shows OFFLINE — the host defines
no network globals (yet), which
[`ps2/lib/leaderboard.js`](ps2/lib/leaderboard.js) handles by design. CI
builds the NRO as a private run artifact on every push
([.github/workflows/switch.yml](.github/workflows/switch.yml)); since the
art is ripped, the NRO is for personal use on your own console — don't
publish it.

## Controls

- **Left stick / d-pad** move · **right stick** aim + fire (twin-stick)
- **CROSS** auto-aim fire (for pads with no right stick — and the keyboard)
- **L1** barrier dash · **R1** cycle weapon (ION / CIGA / PAC)
- **START** pause · **SELECT** restart run
- Keyboard: arrows/WASD move, SPACE fire, Q dash, E weapon, ENTER start,
  SHIFT restart
- Touch: **Touch Twin-Stick** in the launcher — see below
- Player slots wear different rigs: **P1** is Duke (shmup-party-phaser4's
  attract hero), **P2** the classic trooper, **P3/P4** Contra's Bill and
  Lance

### Touch Twin-Stick

On a phone the game is played through the
[shmupX / cmg launcher](https://github.com/shmupX/shmupX.github.io), whose
Guide carries a **Touch Twin-Stick** toggle for the games that advertise it
(this one does, on boot, with `{ type: 'cmg-twinstick', default: true }`): the
left half of the screen becomes the move stick, the right half aim + fire.

Whichever way those sticks arrive, they arrive as ANALOG AXES AND NOTHING ELSE
— the launcher's virtual pad reports all sixteen buttons unpressed — so a
player on glass could move and aim and could never press START, the one button
the title screen, a spectator seat, the perk picker and the game-over board all
wait on. [`src/web/touch-controls.ts`](src/web/touch-controls.ts) puts that
button back:

- **Where.** Top centre of the right half — the far corner of the aim thumb's
  reach — clamped clear of the launcher's own top-right corner zone (the
  two-finger gesture that opens the Guide) on viewports too narrow for 75% to
  clear it by itself.
- **When.** It is up whenever the game is waiting, and gone the whole time the
  game is being played: any stick input hides it at once (so does pressing it),
  and it drifts back about a second after the last finger lifts. START is what
  every screen wants, so nothing is out of reach — but nothing is on screen
  during a run either.
- **Which document.** Installed from the eShop the build is served same-origin
  (`/eshop/shmup-party-ps2/…`), and the launcher's touch zones then cover this
  frame entirely — so the button is mounted into the launcher's own document,
  above them, and taken back out the moment those zones come down (the Guide
  opening, or the toggle going off). Served cross-origin the launcher can't
  patch us: it posts `cmg-twinstick-touch-set` instead and this module provides
  the zones, the stick visuals and the vectors itself, in our own page — the
  shape shmup-party-phaser4's `touch-controls.ts` established.

`?touch=1` on the play page forces the whole thing on without a launcher (and
`?touch=0` off), which is how to see it on a desktop.

What touch still does not reach, because `ps2/` reads those as plain button
edges and no on-screen control emits them: the barrier dash (L1) and the weapon
cycle (R1), picking a perk other than the middle one (START confirms the
highlighted card; only LEFT/RIGHT move it), moving between the three game-over
initials, and leaving a spectator seat early (SELECT/TRIANGLE). A run plays
start to finish on sticks and START — this adds the button the flow was
missing, not a full on-screen pad.

## Demo mode

Leave the title alone for ten seconds and it rolls the Crimsonland demo
reel — the menu and upsell demos from the Android rip's `demos.xml`
([`ps2/data/demos.js`](ps2/data/demos.js), generated by
[`scripts/prep-demos.py`](scripts/prep-demos.py)), played in order by
AI troopers with each node's scripted spots, weapons, spawns and duration.
Press **L1+R1** (keyboard **Q+E**) on the demo screen to grab **Player 2**
and play inside the rolling reel; **START** returns to the title.

## Global leaderboard (SpacetimeDB)

Survival runs post to a global leaderboard backed by
[SpacetimeDB](https://spacetimedb.com) — database `shmup-party-leaderboard`
on maincloud ([dashboard](https://spacetimedb.com/shmup-party-leaderboard)).
Every kill scores its Crimsonland `experience_worth` (creature-variants.xml),
carried per enemy/variant as `score` in
[`ps2/data/tuning.js`](ps2/data/tuning.js); on game over an arcade
initials screen ([`ps2/screens/gameover.js`](ps2/screens/gameover.js))
submits the run and shows the global top 10, and the title screen shows the
top 3.

[`ps2/lib/leaderboard.js`](ps2/lib/leaderboard.js) speaks SpacetimeDB's
HTTP API on both targets: `fetch` in the browser, AthenaEnv's `Network` +
`Request` (TLS 1.2) on real hardware, and it degrades to an OFFLINE board
when neither can reach the host. The server module lives in
[`spacetimedb/`](spacetimedb/) (TypeScript): one public `score` table the
`submit_score` reducer trims to the global top 100, so clients read it with
one-off SQL and sort client-side. Deploy changes with:

```sh
cd spacetimedb/spacetimedb
npm install
spacetime publish        # database + server from ../spacetime*.json
```

`LEADERBOARD` in `ps2/data/tuning.js` picks the host + database — point it
at `http://127.0.0.1:3000` (`spacetime start` + `spacetime publish --server
local`) to develop against a local instance.

## Porting notes

AthenaEnv's `Image` has crops + flips but **no rotation**, and the GS tops
out at 1024px textures — so [`scripts/prep-assets.py`](scripts/prep-assets.py)
pre-rotates the player ship and ion bolt into 16-direction sheets, repacks
the 64-frame zombie/alien atlases into 8-frame strips, rasterizes a Share
Tech Mono bitmap-font grid (one text path for both targets), and composes
the 640x448 background. Frame metadata lands in the generated
[`ps2/data/sheets.js`](ps2/data/sheets.js).

Waves, perks, powerups, the barrier dash and the Evil Brain boss are ported
from the Phaser original's scenes/game-objects, retuned for a single-screen
640x448 arena (the original plays on a 1680x1050 scrolling world).

The arena floor is Crimsonland's terrain generator run at build time: no
runtime rotation means the rip's `terrains.xml` draw-ops (random-angle
tiles, splashes, footprint trails, quest-gated decorations) can't run on
the PS2, so [`scripts/prep-terrains.py`](scripts/prep-terrains.py)
interprets the repo-local
[`scripts/art/terrains.xml`](scripts/art/terrains.xml) with PIL and bakes
seeded 640x448 variants (`ps2/assets/terrain_*.png`, metadata in the
generated [`ps2/data/terrains.js`](ps2/data/terrains.js)). The survival
desert (`CHAPTER_2`) is adjusted to keep the original scorched-earth
`bg.png` visible under the desert wash; each run picks a random variant and
mirror-flips it, so 3 PNGs read as 12 arenas.

Sfx come from the original's `assets/sfx` mp3 pack, the Crimsonland rip's own
`sfx` folder, and `scripts/sfx` for one-offs (PAC fires the arcade coin
jingle), converted by
`prep-assets.py` into audsrv ADPCM (`.adp`, played through AthenaEnv's
`Sound.Sfx` — `audsrv = true` in [`ps2/athena.ini`](ps2/athena.ini)) plus a
`.wav` twin the browser build plays through a Phaser-backed `Sound` shim
([`src/web/sound-shim.ts`](src/web/sound-shim.ts)).
[`ps2/lib/audio.js`](ps2/lib/audio.js) owns the bank, volumes and the
per-effect spam throttle; every call no-ops on hosts without the Sound API.
Death splats get their own pair of takes, alternated so a kill streak doesn't
sound like one sample stuttering.
