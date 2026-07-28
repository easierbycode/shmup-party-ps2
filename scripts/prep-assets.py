#!/usr/bin/env python3
"""Build the PS2 asset set from shmup-party-sp's source art and audio.

AthenaEnv's Image API has no rotation and the PS2 GS tops out at 1024px
textures, so the source art is adapted at build time:

  - creature atlases (zombie/alien/spider2 — too tall for the GS) are
    repacked into 8-frame untrimmed horizontal strips; spider2 also yields
    a spider-die strip from its 64-frame death animation
  - the player ship and ion bolt get 16 pre-rotated direction frames
    (22.5 deg steps, matching heading = atan2(dy,dx) in screen coords)
  - a Share Tech Mono bitmap-font grid (chars 32..127, 16 cols) replaces
    runtime TTF/canvas text so browser and PS2 share one text path
  - the 128px scorched-earth tile is pre-composed into one 640x448 bg

Everything else is copied verbatim. Frame metadata is emitted as the
generated module ps2/data/sheets.js (single source of truth for both
platforms). Rerun after changing source art:

  python3 scripts/prep-assets.py [path-to-shmup-party-sp/public/assets]
"""

import json
import math
import shutil
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "shmup-party-sp" / "public" / "assets"
# Crimsonland Android rips (loose per-frame PNGs): beetle, crabfly, …
CRIMSON = Path(sys.argv[2]) if len(sys.argv) > 2 else (
    Path.home() / "Downloads" / "CRIMSONLAND_ANDROID_EXTRACTED_ASSETS"
    / "CRIMSONLAND_ANDROID_EXTRACTED_ASSETS" / "creatures"
)
OUT = ROOT / "ps2" / "assets"
FONT_TTF = ROOT / "scripts" / "ShareTechMono-Regular.ttf"

OUT.mkdir(parents=True, exist_ok=True)
sheets = {}


def out_file(name):
    """ISO9660 maps '-' to '_' and uppercases; PS2 cdvd lookups are only
    case-insensitive, so hyphens in runtime paths would never resolve on a
    real disc. Emit underscore-only filenames (logical names keep hyphens)."""
    return f"{name.replace('-', '_')}.png"


def repack_atlas(name, prefix, picks, out=None):
    """Extract `picks` frames from a TexturePacker atlas into an untrimmed strip."""
    out = out or name
    data = json.loads((SRC / f"{name}.json").read_text())
    tex = data["textures"][0]
    frames = {f["filename"]: f for f in tex["frames"]}
    sheet = Image.open(SRC / tex["image"]).convert("RGBA")

    first = frames[f"{prefix}{picks[0]:04d}"]
    cw, ch = first["sourceSize"]["w"], first["sourceSize"]["h"]
    strip = Image.new("RGBA", (cw * len(picks), ch), (0, 0, 0, 0))

    for i, n in enumerate(picks):
        f = frames[f"{prefix}{n:04d}"]
        r = f["frame"]
        cell = sheet.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
        off = f["spriteSourceSize"]
        strip.paste(cell, (i * cw + off["x"], off["y"]))

    strip.save(OUT / out_file(out))
    sheets[out] = {"file": f"assets/{out_file(out)}", "fw": cw, "fh": ch, "count": len(picks)}


DIRS = 16  # rotation steps; 360/16 = 22.5 deg, matching util.js dirFrame()


def rotations(src_name, out_name, cell, base_angle, fw=None, fh=None, frames=None, cols=8):
    """DIRS pre-rotated directions for each animation frame, laid out row-major
    across `cols` columns: sheet frame index = anim * DIRS + direction, so
    direction d points along heading d*22.5 deg (screen coords, clockwise from
    east). base_angle is the heading the source art natively faces.

    `fw`/`fh` size one cell of a source *strip* and default to the whole image;
    `frames` picks which of those cells to pre-rotate (default: all of them).
    Passing a strip without fw/fh silently centre-crops it to `cell` — that is
    what turned ion.png (4 frames of 48x30) into 16 rotations of two half
    frames welded together, so always state the source cell size for a strip.

    `cols` only shapes the grid; keep cell*cols and cell*rows <= 1024, the GS
    texture limit (that is why player stays 8 wide: 16*72 would be 1152)."""
    img = Image.open(SRC / src_name).convert("RGBA")
    fw = fw or img.width
    fh = fh or img.height
    frames = list(range(img.width // fw)) if frames is None else list(frames)
    rows = math.ceil(len(frames) * DIRS / cols)

    grid = Image.new("RGBA", (cell * cols, cell * rows), (0, 0, 0, 0))
    for a, f in enumerate(frames):
        canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
        canvas.paste(img.crop((f * fw, 0, (f + 1) * fw, fh)),
                     ((cell - fw) // 2, (cell - fh) // 2))
        for d in range(DIRS):
            rot = canvas.rotate(-(d * 22.5 - base_angle), resample=Image.BICUBIC)
            i = a * DIRS + d
            grid.paste(rot, ((i % cols) * cell, (i // cols) * cell))

    grid.save(OUT / out_file(out_name))
    sheets[out_name] = {
        "file": f"assets/{out_file(out_name)}", "fw": cell, "fh": cell,
        "count": len(frames) * DIRS, "cols": cols, "rotated": True,
        "dirs": DIRS, "anim": len(frames),
    }


def crimson_strip(out, subdir, pattern, picks):
    """Pack loose Crimsonland frame files (pattern % n) into an untrimmed strip."""
    frames = [Image.open(CRIMSON / subdir / (pattern % n)).convert("RGBA") for n in picks]
    cw = max(f.width for f in frames)
    ch = max(f.height for f in frames)
    strip = Image.new("RGBA", (cw * len(frames), ch), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.paste(f, (i * cw + (cw - f.width) // 2, (ch - f.height) // 2))
    strip.save(OUT / out_file(out))
    sheets[out] = {"file": f"assets/{out_file(out)}", "fw": cw, "fh": ch, "count": len(picks)}


def crimson_gibs(out, subdir, pattern, picks):
    """Debris strip for a death particle burst: each source frame is mostly
    empty 72x72 with the bodypart off-center, so trim to the alpha bbox and
    re-center in a uniform cell — gibs spawn at the corpse and must not carry
    the source frame's offset."""
    parts = []
    for n in picks:
        img = Image.open(CRIMSON / subdir / (pattern % n)).convert("RGBA")
        parts.append(img.crop(img.getbbox()))
    cw = max(p.width for p in parts)
    ch = max(p.height for p in parts)
    cw += cw % 2
    ch += ch % 2
    strip = Image.new("RGBA", (cw * len(parts), ch), (0, 0, 0, 0))
    for i, p in enumerate(parts):
        strip.paste(p, (i * cw + (cw - p.width) // 2, (ch - p.height) // 2))
    strip.save(OUT / out_file(out))
    sheets[out] = {"file": f"assets/{out_file(out)}", "fw": cw, "fh": ch, "count": len(parts)}


def font_sheet():
    size = 16
    font = ImageFont.truetype(str(FONT_TTF), size)
    cw = math.ceil(font.getlength("M"))
    asc, desc = font.getmetrics()
    ch = asc + desc
    cols, rows = 16, 6  # chars 32..127
    img = Image.new("RGBA", (cw * cols, ch * rows), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for code in range(32, 128):
        i = code - 32
        draw.text(((i % cols) * cw, (i // cols) * ch), chr(code), font=font, fill=(255, 255, 255, 255))
    img.save(OUT / "font.png")
    sheets["font"] = {"file": "assets/font.png", "fw": cw, "fh": ch, "count": 96, "cols": cols, "first": 32}


def background():
    tile = Image.open(SRC / "scorched-earth.png").convert("RGBA")
    bg = Image.new("RGBA", (640, 448))
    for y in range(0, 448, tile.height):
        for x in range(0, 640, tile.width):
            bg.paste(tile, (x, y))
    bg.save(OUT / "bg.png")


# name -> (source file, frame w, frame h)  [w=None copies without sheet metadata]
COPIES = {
    "logo": ("logo.png", None, None),
    "ion-impact": ("ion-impact.png", 18, 22),
    "pac-ghost": ("pac-ghost.png", 13, 14),
    "smoke": ("smoke.png", 26, 33),
    "blood-splat": ("blood-splat.png", 137, 136),
    "bullet": ("bullet.png", 12, 11),
    "chomp-ball": ("chomp-ball.png", 32, 32),
    "brain-top": ("evil-brain-top.png", 96, 58),
    "brain-bottom": ("evil-brain-bottom.png", 80, 56),
    "brain-eye": ("evil-brain-eye.png", 22, 10),
    "brain-bullet": ("evil-brain-bullet.png", 16, 16),
    "brain-prefire": ("evil-brain-bullet-prefire.png", 16, 16),
    "eye-explode": ("eye-explode.png", 61, 67),
    "explosion-0": ("explosion-0.png", None, None),
    "explosion-1": ("explosion-1.png", None, None),
    "explosion-circle": ("explosion-circle.png", None, None),
    "explosion-skull": ("explosion-skull.png", None, None),
    "powerup-speed": ("powerup-speed.png", None, None),
    "powerup-medikit": ("powerup-medikit.png", None, None),
    "powerup-nuke": ("powerup-nuke.png", None, None),
    "powerup-fireblast": ("powerup-fireblast.png", None, None),
    "powerup-boost": ("powerup-weapon-boost.png", None, None),
    "powerup-freeze": ("powerup-freeze.png", None, None),
    "perk-speed": ("perk-speed.png", None, None),
    "perk-fire-rate": ("perk-fire-rate.png", None, None),
    "perk-damage": ("perk-damage.png", None, None),
}


def copies():
    for name, (src, fw, fh) in COPIES.items():
        path = SRC / src
        if not path.exists():
            continue
        img = Image.open(path).convert("RGBA")
        img.save(OUT / out_file(name))
        if fw:
            sheets[name] = {
                "file": f"assets/{out_file(name)}", "fw": fw, "fh": fh,
                "count": img.width // fw * (img.height // fh),
            }


# --- sound effects ---------------------------------------------------------
#
# Role name -> source mp3 (relative to SRC/sfx). Role names must be
# lowercase underscore-only: ISO9660 maps '-' to '_' and uppercases, and
# PS2 cdvd lookups are only case-insensitive, so anything else would
# never resolve on a real disc (same constraint as out_file above).
SFX = {
    "ion_fire": "shock_fire.mp3",
    "ciga_fire": "flamer_fire_01.mp3",
    # PAC fires the arcade coin-insert jingle
    "pac_fire": "credit.wav",
    "dash": "shockwave.mp3",
    "fireblast": "explosion_medium.mp3",
    "switch": "ui_clink_01.mp3",
    "button_press": "button-press.wav",
    "ion_hit": "shock_hit_01.mp3",
    "ciga_hit": "bullet_hit_01.mp3",
    "pac_hit": "bullet_hit_02.mp3",
    # two takes so a stream of kills doesn't sound like one sample on repeat
    "blood_01": "bloodSpill_01.wav",
    "blood_02": "bloodSpill_02.wav",
}

# sources are looked up in order: this repo's own scripts/sfx (one-offs that
# aren't in either pack, e.g. the coin jingle), then the original's mp3 pack,
# then the Crimsonland rip's sfx folder (sibling of CRIMSON's creatures dir),
# where the blood spills and the UI button press live
SFX_DIRS = (ROOT / "scripts" / "sfx", SRC / "sfx", CRIMSON.parent / "sfx")

FFMPEG = Path(shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg")
SFX_RATE = 22050

# SPU2 ADPCM filter predictors, from ps2sdk tools/adpenc/src/adpcm.c
# (coefficients (0,0),(60,0),(115,-52),(98,-55),(122,-60) over 64).
SPU_F = (
    (0.0, 0.0),
    (-60.0 / 64.0, 0.0),
    (-115.0 / 64.0, 52.0 / 64.0),
    (-98.0 / 64.0, 55.0 / 64.0),
    (-122.0 / 64.0, 60.0 / 64.0),
)


def find_sfx(name):
    for d in SFX_DIRS:
        if (d / name).exists():
            return d / name
    sys.exit(f"[prep-assets] missing source sfx: {name} (looked in {', '.join(map(str, SFX_DIRS))})")


def wav_from_mp3(src, dst):
    """mp3 -> mono 16-bit 22050 Hz WAV via ffmpeg, then verify the header
    is the canonical 44-byte layout with the data chunk at offset 36
    (AthenaEnv's Sound.Stream hard-seeks PCM past a fixed-size header, so
    a LIST/metadata chunk would corrupt playback). Returns the PCM body."""
    subprocess.run(
        [str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(src), "-ac", "1", "-ar", str(SFX_RATE),
         "-sample_fmt", "s16", "-fflags", "+bitexact", "-f", "wav", str(dst)],
        check=True,
    )
    b = dst.read_bytes()
    fmt_size, audio_fmt, ch, rate = struct.unpack_from("<IHHI", b, 16)
    balign, bits = struct.unpack_from("<HH", b, 32)
    data_size = struct.unpack_from("<I", b, 40)[0]
    ok = (len(b) > 44 and b[:4] == b"RIFF" and b[8:16] == b"WAVEfmt "
          and fmt_size == 16 and audio_fmt == 1 and ch == 1
          and rate == SFX_RATE and balign == 2 and bits == 16
          and b[36:40] == b"data" and data_size == len(b) - 44
          and struct.unpack_from("<I", b, 4)[0] == len(b) - 8)
    if not ok:
        sys.exit(f"[prep-assets] {dst.name}: ffmpeg did not emit a canonical 44-byte WAV header")
    return b[44:]


def spu_find_predict(samples, state):
    """Port of adpenc find_predict(): pick the predictor with the smallest
    peak residual over the 28-sample block, then derive the shift factor.
    state carries the C statics (_s_1/_s_2: last two clamped inputs)."""
    buf = [[0.0] * 5 for _ in range(28)]
    mx = [0.0] * 5
    mn = 1e10
    predict_nr = 0
    s_1 = s_2 = 0.0
    for i in range(5):
        s_1, s_2 = state["fs1"], state["fs2"]
        for j in range(28):
            s_0 = float(min(30719, max(-30720, samples[j])))
            ds = s_0 + s_1 * SPU_F[i][0] + s_2 * SPU_F[i][1]
            buf[j][i] = ds
            if abs(ds) > mx[i]:
                mx[i] = abs(ds)
            s_2, s_1 = s_1, s_0
        if mx[i] < mn:
            mn = mx[i]
            predict_nr = i
        if mn <= 7:
            predict_nr = 0
            break
    state["fs1"], state["fs2"] = s_1, s_2

    min2 = int(mn)
    shift_mask = 0x4000
    shift_factor = 0
    while shift_factor < 12:
        if shift_mask & (min2 + (shift_mask >> 3)):
            break
        shift_factor += 1
        shift_mask >>= 1
    return predict_nr, shift_factor, [buf[i][predict_nr] for i in range(28)]


def spu_pack(d_samples, predict_nr, shift_factor, state):
    """Port of adpenc pack(): quantize 28 residuals to 4 bits (kept in the
    top nibble of a 16-bit value, adpenc-style) with IIR feedback of the
    quantization error. state carries the C statics (s_1/s_2)."""
    s_1, s_2 = state["ps1"], state["ps2"]
    four_bit = []
    for i in range(28):
        s_0 = d_samples[i] + s_1 * SPU_F[predict_nr][0] + s_2 * SPU_F[predict_nr][1]
        ds = s_0 * (1 << shift_factor)
        di = (int(ds) + 0x800) & 0xFFFFF000
        if di & 0x80000000:  # C does this AND on a signed 32-bit int
            di -= 1 << 32
        di = min(32767, max(-32768, di))
        four_bit.append(di)
        di >>= shift_factor  # Python >> is arithmetic, like the C original
        s_2, s_1 = s_1, float(di) - s_0
    state["ps1"], state["ps2"] = s_1, s_2
    return four_bit


def adp_from_pcm(pcm, dst):
    """PCM s16le bytes -> audsrv .adp: 16-byte "APCM" header (id, version,
    channels, loop, reserved, pitch = rate*4096/48000, sample count) then
    SPU2 ADPCM blocks of 16 bytes = pack_info + flags + 28 nibbles, ported
    from ps2sdk tools/adpenc (adpcm_encode with flag_loop=0): flags are 0,
    except 1 on a final zero-padded partial block, then one terminator
    block with flags 7 and 14 zero data bytes."""
    n = len(pcm) // 2
    samples = list(struct.unpack(f"<{n}h", pcm))
    groups = (n + 27) // 28
    samples += [0] * (groups * 28 - n)

    out = bytearray(b"APCM")
    out += struct.pack("<BBBBII", 1, 1, 0, 0, SFX_RATE * 4096 // 48000, n)

    state = {"fs1": 0.0, "fs2": 0.0, "ps1": 0.0, "ps2": 0.0}
    predict_nr = shift_factor = flags = 0
    sample_len = n
    for j in range(groups):
        block = samples[j * 28:(j + 1) * 28]
        predict_nr, shift_factor, d_samples = spu_find_predict(block, state)
        four_bit = spu_pack(d_samples, predict_nr, shift_factor, state)
        out.append((predict_nr << 4) | shift_factor)
        out.append(flags)
        for k in range(0, 28, 2):
            out.append(((four_bit[k + 1] >> 8) & 0xF0) | ((four_bit[k] >> 12) & 0xF))
        sample_len -= 28
        if sample_len < 28:
            flags = 1
    out.append((predict_nr << 4) | shift_factor)
    out.append(7)  # end flag
    out += bytes(14)
    dst.write_bytes(bytes(out))


def sfx():
    if not FFMPEG.exists():
        sys.exit(f"[prep-assets] ffmpeg not found at {FFMPEG}")
    sfx_out = OUT / "sfx"
    sfx_out.mkdir(parents=True, exist_ok=True)
    for name, src in SFX.items():
        pcm = wav_from_mp3(find_sfx(src), sfx_out / f"{name}.wav")
        adp_from_pcm(pcm, sfx_out / f"{name}.adp")
        print(f"  {name:16s} {len(pcm) // 2} samples @ {SFX_RATE} Hz  <- {src}")


def emit_js():
    lines = [
        "// GENERATED by scripts/prep-assets.py — do not edit by hand.",
        "// Frame metadata for every animated/rotated sheet in ps2/assets.",
        "export const SHEETS = " + json.dumps(sheets, indent=2, sort_keys=True) + ";",
        "",
    ]
    gen = ROOT / "ps2" / "data"
    gen.mkdir(parents=True, exist_ok=True)
    # explicit utf-8: write_text() defaults to the system codepage, which
    # mangles the em-dash in the banner when this runs on Windows
    (gen / "sheets.js").write_text("\n".join(lines), encoding="utf-8")


picks = [1, 9, 17, 25, 33, 41, 49, 57]
repack_atlas("zombie", "move-", picks)
repack_atlas("alien", "move-", picks)
# spider2 frames 64 are 64x64 cells (all others 72x72) — picks avoid them
repack_atlas("spider2", "move-", picks, out="spider")
repack_atlas("spider2", "die-", picks, out="spider-die")
if CRIMSON.is_dir():
    crimson_strip("beetle", "beetle", "move-%04d.png", picks)
    crimson_gibs("beetle-gib", "beetle", "bodypart-unique-%04d.png", [1, 2, 3])
    crimson_strip("crabfly", "crabfly", "crabfly-move-%04d.png", [0, 2, 4, 6, 8, 10, 12, 14])
    crimson_strip("crabfly-die", "crabfly", "crabfly-die-%04d.png", list(range(8)))
else:
    print(f"[prep-assets] WARNING: {CRIMSON} not found — skipping beetle/crabfly")
rotations("player.png", "player", 72, 0)
# every projectile that reads as pointing somewhere needs direction frames, or
# it flies sideways: the ion bolt's burst leads and its tail streams behind,
# the cigarette leads with its sunglasses, pacman chomps forward. bullet.png is
# a round glow — symmetric, so it stays a plain 2-frame strip. base angles are
# what playtesting proved out — front leads, not trails.
# all four ion frames are pre-rotated so the bolt crackles in flight like the
# original's 20fps loop; 4 anim x 16 dirs of 64px cells is a 512x512 grid,
# still inside the GS texture limit
rotations("ion.png", "ion", 64, 180, fw=48, fh=30)
rotations("ciga-bullet.png", "ciga", 16, 90, fw=9, fh=12, cols=16)
rotations("pacman-spritesheet.png", "pacman", 32, 0, fw=32, fh=32, cols=16)
# the dash barrier swings to whatever direction the dash travels. The arc's
# dense shield face is at the LEFT of the source cell with the trail streaming
# right, so it natively faces 180 (the Phaser original says the same with
# bulletAngleOffset = 180) — with base_angle 0 it dashed tail-first. Two of its
# eight shimmer frames keep the crackle; 90px cells fit the 80x41 arc's
# rotation diagonal (hypot = 89.9)
rotations("barrier.png", "barrier", 90, 180, fw=80, fh=41, frames=[0, 4])
font_sheet()
background()
copies()
sfx()
emit_js()

for name, meta in sorted(sheets.items()):
    print(f"  {name:16s} {meta['fw']}x{meta['fh']} x{meta['count']}")
print(f"[prep-assets] wrote {len(list(OUT.glob('*.png')))} PNGs to {OUT}")
print(f"[prep-assets] wrote {len(SFX)} sfx as .wav + .adp to {OUT / 'sfx'}")
