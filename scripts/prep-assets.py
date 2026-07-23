#!/usr/bin/env python3
"""Build the PS2 asset set from shmup-party-sp's source art.

AthenaEnv's Image API has no rotation and the PS2 GS tops out at 1024px
textures, so the source art is adapted at build time:

  - zombie/alien atlases (255x1193 / 254x1555 — too tall for the GS) are
    repacked into 8-frame untrimmed horizontal strips
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
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "shmup-party-sp" / "public" / "assets"
OUT = ROOT / "ps2" / "assets"
FONT_TTF = ROOT / "scripts" / "ShareTechMono-Regular.ttf"

OUT.mkdir(parents=True, exist_ok=True)
sheets = {}


def out_file(name):
    """ISO9660 maps '-' to '_' and uppercases; PS2 cdvd lookups are only
    case-insensitive, so hyphens in runtime paths would never resolve on a
    real disc. Emit underscore-only filenames (logical names keep hyphens)."""
    return f"{name.replace('-', '_')}.png"


def repack_atlas(name, prefix, picks):
    """Extract `picks` frames from a TexturePacker atlas into an untrimmed strip."""
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

    strip.save(OUT / out_file(name))
    sheets[name] = {"file": f"assets/{out_file(name)}", "fw": cw, "fh": ch, "count": len(picks)}


def rotations(src_name, out_name, cell, base_angle):
    """16 pre-rotated frames, 8 cols x 2 rows. Frame i points along heading
    i*22.5 deg (screen coords, clockwise from east). base_angle is the
    heading the source art natively faces."""
    img = Image.open(SRC / src_name).convert("RGBA")
    canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    canvas.paste(img, ((cell - img.width) // 2, (cell - img.height) // 2))

    grid = Image.new("RGBA", (cell * 8, cell * 2), (0, 0, 0, 0))
    for i in range(16):
        rot = canvas.rotate(-(i * 22.5 - base_angle), resample=Image.BICUBIC)
        grid.paste(rot, ((i % 8) * cell, (i // 8) * cell))

    grid.save(OUT / out_file(out_name))
    sheets[out_name] = {
        "file": f"assets/{out_file(out_name)}", "fw": cell, "fh": cell,
        "count": 16, "cols": 8, "rotated": True,
    }


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
    "pacman": ("pacman-spritesheet.png", 32, 32),
    "pac-ghost": ("pac-ghost.png", 13, 14),
    "ciga": ("ciga-bullet.png", 9, 12),
    "smoke": ("smoke.png", 26, 33),
    "barrier": ("barrier.png", 80, 41),
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


def emit_js():
    lines = [
        "// GENERATED by scripts/prep-assets.py — do not edit by hand.",
        "// Frame metadata for every animated/rotated sheet in ps2/assets.",
        "export const SHEETS = " + json.dumps(sheets, indent=2, sort_keys=True) + ";",
        "",
    ]
    gen = ROOT / "ps2" / "data"
    gen.mkdir(parents=True, exist_ok=True)
    (gen / "sheets.js").write_text("\n".join(lines))


picks = [1, 9, 17, 25, 33, 41, 49, 57]
repack_atlas("zombie", "move-", picks)
repack_atlas("alien", "move-", picks)
rotations("player.png", "player", 72, 0)
rotations("ion.png", "ion", 64, 180)
font_sheet()
background()
copies()
emit_js()

for name, meta in sorted(sheets.items()):
    print(f"  {name:16s} {meta['fw']}x{meta['fh']} x{meta['count']}")
print(f"[prep-assets] wrote {len(list(OUT.glob('*.png')))} PNGs to {OUT}")
