#!/usr/bin/env python3
"""Bake Crimsonland terrains into ready-to-draw PS2 backgrounds.

AthenaEnv's Image API has no rotation and PS2-side JS can't afford hundreds
of per-frame decal draws, so — like prep-assets.py's pre-composed bg.png —
the terrain generator from the Android rip's terrains.xml runs at build
time: this script interprets the XML draw-ops with PIL and emits finished
640x448 arenas. Several seeded variants are baked per terrain (the runtime
also mirror-flips them, so 3 PNGs read as 12 arenas).

Definitions live in the repo-local scripts/art/terrains.xml. Bitmap refs
resolve against the rip ("terrains/...") and ps2/assets ("assets/...").

Supported actions: Clear, SetSeeds, DrawTiled, DrawSplashes, DrawSingle,
FootPrints, DrawVoronoi, DrawWithPerlinNoise, DrawPerlin, DrawTerrain
(recursion, with quest_number_required gating), plus two extensions:
DrawFill (bm stretched over the whole terrain — used to keep the original
bg.png under CHAPTER_2's desert) and DrawTerrain quest_number comma lists
(per-variant quests, so variants walk a chapter's decoration
progression). The perlin/voronoi ops are visual approximations of the
original renderer, not bit-exact ports.

The XML was authored for Crimsonland's ~1024x1024 arenas; positions map
proportionally onto 640x448 and num_splashes scales by area so density
matches the original. Bitmaps keep their native pixel size (the creature
art already shares that scale).

Emits terrain_<id>_<n>.png into ps2/assets plus ps2/data/terrains.js
(variant counts, from the files present after baking). Rerun after
changing scripts/art/terrains.xml:

  python3 scripts/prep-terrains.py [path-to-rip-root] [--id SURVIVAL]
                                   [--variants 3] [--quest N]
"""

import argparse
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from random import Random

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
XML = ROOT / "scripts" / "art" / "terrains.xml"
OUT = ROOT / "ps2" / "assets"
DEFAULT_RIP = (
    Path.home() / "Downloads" / "CRIMSONLAND_ANDROID_EXTRACTED_ASSETS"
    / "CRIMSONLAND_ANDROID_EXTRACTED_ASSETS"
)

W, H = 640, 448          # arena == screen (util.js SCREEN_W/H)
REF_W, REF_H = 1024, 1024  # arena size the XML's counts/positions assume
AREA = (W * H) / (REF_W * REF_H)

bitmaps = {}


def f(node, name, default=0.0):
    return float(node.get(name, default))


def load_bm(rip, ref):
    """'terrains/foo.png' -> rip, 'assets/foo.png' -> ps2/assets. A few XML
    refs (metal_plate-01 etc.) omit the extension."""
    if not ref.endswith(".png"):
        ref += ".png"
    if ref in bitmaps:
        return bitmaps[ref]
    base = ROOT / "ps2" if ref.startswith("assets/") else rip
    im = Image.open(base / ref).convert("RGBA")
    bitmaps[ref] = im
    return im


def stamp(dst, im, x, y):
    """Alpha-composite `im` onto `dst` with its top-left at (x, y), clipping
    at the edges (paste() would composite wrongly on an RGBA layer, and
    alpha_composite() rejects negative offsets)."""
    sx, sy = max(0, -x), max(0, -y)
    dx, dy = max(0, x), max(0, y)
    w = min(im.width - sx, dst.width - dx)
    h = min(im.height - sy, dst.height - dy)
    if w <= 0 or h <= 0:
        return
    part = im.crop((sx, sy, sx + w, sy + h))
    if dst.mode == "RGBA":
        region = dst.crop((dx, dy, dx + w, dy + h))
        dst.paste(Image.alpha_composite(region, part), (dx, dy))
    else:
        dst.paste(part, (dx, dy), part)


def prepared(bm, angle=0.0, scale=1.0, alpha=1.0):
    im = bm
    if scale != 1.0:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                       Image.BICUBIC)
    if angle % 360.0:
        im = im.rotate(-angle, expand=True, resample=Image.BICUBIC)
    if alpha < 1.0:
        im = im.copy()
        im.putalpha(im.getchannel("A").point(lambda v: round(v * alpha)))
    return im


def splash(dst, bm, cx, cy, angle=0.0, scale=1.0, alpha=1.0):
    im = prepared(bm, angle, scale, alpha)
    stamp(dst, im, round(cx - im.width / 2), round(cy - im.height / 2))


def value_noise(rng, cells_x, cells_y):
    """Bilinear value noise sampler over a random lattice, 0..1."""
    grid = [[rng.random() for _ in range(cells_x + 2)] for _ in range(cells_y + 2)]

    def at(u, v):  # u, v in 0..1
        gx, gy = u * cells_x, v * cells_y
        ix, iy = int(gx), int(gy)
        fx, fy = gx - ix, gy - iy
        a = grid[iy][ix] * (1 - fx) + grid[iy][ix + 1] * fx
        b = grid[iy + 1][ix] * (1 - fx) + grid[iy + 1][ix + 1] * fx
        return a * (1 - fy) + b * fy

    return at


# ── draw actions ────────────────────────────────────────────────────────────


def act_clear(ctx, n):
    r = f(n, "r", f(n, "color_r"))
    g = f(n, "g", f(n, "color_g"))
    b = f(n, "b", f(n, "color_b"))
    ctx["img"].paste((round(r * 255), round(g * 255), round(b * 255)), (0, 0, W, H))


def act_set_seeds(ctx, n):
    seeds = [int(s) for s in n.get("seeds").split(",")]
    ctx["rng"].seed(seeds[ctx["variant"] % len(seeds)])


def act_draw_fill(ctx, n):
    bm = load_bm(ctx["rip"], n.get("bm")).resize((W, H), Image.BICUBIC)
    if (a := f(n, "alpha", 1)) < 1.0:
        bm = bm.copy()
        bm.putalpha(bm.getchannel("A").point(lambda v: round(v * a)))
    stamp(ctx["img"], bm, 0, 0)


def act_draw_tiled(ctx, n):
    """Random-angle tile blobs on a 'tile_spacing * size' grid. With alpha < 1
    the pass composes into its own layer first so the wash lands evenly
    instead of stacking to opaque where blobs overlap."""
    rng = ctx["rng"]
    alpha = f(n, "alpha", 1)
    bm = load_bm(ctx["rip"], n.get("bm"))
    scale = f(n, "tile_scale", 1)
    step = max(8, round(bm.width * scale * f(n, "tile_spacing", 1)))
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)) if alpha < 1.0 else None
    dst = layer if layer is not None else ctx["img"]
    for gy in range(-step, H + step, step):
        for gx in range(-step, W + step, step):
            x = gx + rng.uniform(-step, step) * 0.3
            y = gy + rng.uniform(-step, step) * 0.3
            splash(dst, bm, x, y, angle=rng.uniform(0, 360), scale=scale)
    if layer is not None:
        layer.putalpha(layer.getchannel("A").point(lambda v: round(v * alpha)))
        stamp(ctx["img"], layer, 0, 0)


def act_draw_splashes(ctx, n):
    rng = ctx["rng"]
    bm = load_bm(ctx["rip"], n.get("bm"))
    num = max(1, round(int(n.get("num_splashes", 1)) * AREA))
    alpha = f(n, "alpha", 1)
    sv = f(n, "size_variation", 1)
    stepping = n.get("angle_stepping")
    for _ in range(num):
        if stepping:
            angle = rng.randrange(0, 360, int(float(stepping)))
        elif "min_rotation_degrees" in n.attrib:
            angle = rng.uniform(f(n, "min_rotation_degrees"), f(n, "max_rotation_degrees"))
        else:
            angle = rng.uniform(0, 360)
        scale = math.exp(rng.uniform(-math.log(sv), math.log(sv))) if sv > 1 else 1.0
        splash(ctx["img"], bm, rng.uniform(0, W), rng.uniform(0, H), angle, scale, alpha)


def act_draw_single(ctx, n):
    bm = load_bm(ctx["rip"], n.get("bm"))
    splash(ctx["img"], bm, f(n, "x") / REF_W * W, f(n, "y") / REF_H * H,
           f(n, "angle_degrees"), f(n, "scale", 1), f(n, "alpha", 1))


def act_footprints(ctx, n):
    """A trail across the arena stamping bm1..bm3 every step_length px,
    heading-aligned, feet alternating stride_width/2 to each side, heading
    wandering by undulation_factor."""
    rng = ctx["rng"]
    bms = [load_bm(ctx["rip"], n.get(k)) for k in ("bm1", "bm2", "bm3") if n.get(k)]
    step = f(n, "step_length", 60)
    scale = f(n, "scale", 1)
    stride = f(n, "stride_width", 0)
    undul = f(n, "undulation_factor", 0)
    alpha = f(n, "alpha", 1)

    heading = rng.uniform(0, math.pi * 2)
    # anchor inside the arena, then start far enough back that the trail
    # always crosses the whole screen
    span = math.hypot(W, H)
    ax, ay = rng.uniform(W * 0.25, W * 0.75), rng.uniform(H * 0.25, H * 0.75)
    x = ax - math.cos(heading) * span
    y = ay - math.sin(heading) * span
    side = 1
    for i in range(int(span * 2 / step) + 2):
        heading += rng.uniform(-1, 1) * undul
        px = x + math.cos(heading + math.pi / 2) * side * stride / 2
        py = y + math.sin(heading + math.pi / 2) * side * stride / 2
        splash(ctx["img"], bms[i % len(bms)], px, py,
               math.degrees(heading), scale, alpha)
        x += math.cos(heading) * step
        y += math.sin(heading) * step
        side = -side


def act_draw_voronoi(ctx, n):
    """Trail bitmap along Voronoi cell edges (where the two nearest of
    num_points sites are near-equidistant), sampled on a coarse grid."""
    rng = ctx["rng"]
    bm = load_bm(ctx["rip"], n.get("bm"))
    num = max(3, round(int(n.get("num_points", 20)) * AREA))
    alpha = f(n, "alpha", 0.1)
    thickness = f(n, "thickness", 8)
    pts = [(rng.uniform(0, W), rng.uniform(0, H)) for _ in range(num)]
    grid = 3
    for y in range(0, H, grid):
        for x in range(0, W, grid):
            d1 = d2 = 1e18
            for px, py in pts:
                d = (px - x) ** 2 + (py - y) ** 2
                if d < d1:
                    d1, d2 = d, d1
                elif d < d2:
                    d2 = d
            if math.sqrt(d2) - math.sqrt(d1) < thickness / 2:
                splash(ctx["img"], bm, x, y, rng.uniform(0, 360), 1.0, alpha)


def act_draw_with_perlin(ctx, n):
    """Bitmap stamped on a sampling_step grid with noise-driven alpha —
    approximates the original's perlin-masked detail scatter."""
    rng = ctx["rng"]
    bm = load_bm(ctx["rip"], n.get("bm"))
    step = max(8, round(f(n, "sampling_step", 40)))
    freq = max(1, round(f(n, "frequency", 8)))
    amp = f(n, "amplitude", 8)
    mult = f(n, "alpha_multiplier", 1)
    scale = f(n, "bitmap_scale", 1)
    noise = value_noise(rng, freq, freq)
    contrast = min(4.0, amp / 8)
    for y in range(0, H, step):
        for x in range(0, W, step):
            v = (noise(x / W, y / H) - 0.5) * contrast + 0.5
            a = mult * min(1.0, max(0.0, v))
            if a < 0.03:
                continue
            splash(ctx["img"], bm, x + rng.uniform(-step, step) / 2,
                   y + rng.uniform(-step, step) / 2, rng.uniform(0, 360), scale, a)


def act_draw_perlin(ctx, n):
    """Large-scale +-8% brightness undulation over the whole terrain."""
    rng = ctx["rng"]
    noise = value_noise(rng, 5, 4)
    img = ctx["img"]
    cell = 16
    for y in range(0, H, cell):
        for x in range(0, W, cell):
            k = 0.92 + 0.16 * noise(x / W, y / H)
            box = (x, y, min(W, x + cell), min(H, y + cell))
            img.paste(ImageEnhance.Brightness(img.crop(box)).enhance(k), box)


def act_draw_terrain(ctx, n):
    """quest_number extension: a comma list picks per baked variant, so the
    variants can walk the chapter's decoration progression."""
    q = n.get("quest_number")
    if q is None:
        quest = ctx["quest"]
    else:
        quests = [int(float(s)) for s in q.split(",")]
        quest = quests[ctx["variant"] % len(quests)]
    run_terrain(ctx, n.get("id"), quest)


ACTIONS = {
    "Clear": act_clear,
    "SetSeeds": act_set_seeds,
    "DrawFill": act_draw_fill,
    "DrawTiled": act_draw_tiled,
    "DrawSplashes": act_draw_splashes,
    "DrawSingle": act_draw_single,
    "FootPrints": act_footprints,
    "DrawVoronoi": act_draw_voronoi,
    "DrawWithPerlinNoise": act_draw_with_perlin,
    "DrawPerlin": act_draw_perlin,
    "DrawTerrain": act_draw_terrain,
}


def run_terrain(ctx, tid, quest):
    arr = ctx["defs"].get(tid)
    if arr is None:
        sys.exit(f"[prep-terrains] unknown terrain id {tid}")
    prev = ctx["quest"]
    ctx["quest"] = quest
    for node in arr:
        req = node.get("quest_number_required")
        if req and quest < int(float(req)):
            continue
        # per the XML notes the default action is DrawSplashes
        action = node.get("action", "DrawSplashes")
        fn = ACTIONS.get(action)
        if fn is None:
            print(f"  [skip] unimplemented action {action}")
            continue
        fn(ctx, node)
    ctx["quest"] = prev


def bake(defs, rip, tid, variant, quest):
    ctx = {
        "defs": defs,
        "rip": rip,
        "img": Image.new("RGB", (W, H), (0, 0, 0)),
        # terrains without SetSeeds still differ per variant
        "rng": Random(variant * 7919 + 1),
        "variant": variant,
        "quest": quest,
    }
    run_terrain(ctx, tid, quest)
    name = f"terrain_{tid.lower()}_{variant}.png"
    ctx["img"].save(OUT / name, optimize=True)
    print(f"  {name}")


def emit_js():
    """ps2/data/terrains.js from the terrain PNGs present after baking, so
    the runtime and the assets can't drift apart."""
    counts = {}
    for p in sorted(OUT.glob("terrain_*.png")):
        m = re.fullmatch(r"terrain_(.+)_(\d+)\.png", p.name)
        if m:
            key = m.group(1).replace("_", "-")
            counts[key] = max(counts.get(key, 0), int(m.group(2)) + 1)
    lines = [
        "// GENERATED by scripts/prep-terrains.py — do not edit by hand.",
        "// Baked terrain variants in ps2/assets (terrain_<id>_<n>.png);",
        "// logical Pic names are terrain-<id>-<n>.",
        "export const TERRAINS = {",
    ]
    for key, count in sorted(counts.items()):
        lines.append(f"  '{key}': {{ variants: {count} }},")
    lines += ["};", ""]
    (ROOT / "ps2" / "data" / "terrains.js").write_text("\n".join(lines), encoding="utf-8")
    print(f"[prep-terrains] wrote ps2/data/terrains.js ({', '.join(counts) or 'empty'})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rip", nargs="?", type=Path, default=DEFAULT_RIP,
                    help="Crimsonland rip root (contains terrains/)")
    ap.add_argument("--id", default="SURVIVAL", help="terrain array id to bake")
    ap.add_argument("--variants", type=int, default=3)
    ap.add_argument("--quest", type=int, default=0,
                    help="quest_number gate when the id itself doesn't set one")
    args = ap.parse_args()
    if not (args.rip / "terrains").is_dir():
        sys.exit(f"[prep-terrains] rip not found at {args.rip}")

    defs = {a.get("id"): a for a in ET.parse(XML).getroot().iter("array")}
    print(f"[prep-terrains] baking {args.id} x{args.variants} at {W}x{H}")
    for v in range(args.variants):
        bake(defs, args.rip, args.id, v, args.quest)
    emit_js()


if __name__ == "__main__":
    main()
