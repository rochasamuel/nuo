#!/usr/bin/env python3
"""
Pixel-art UNO-style card generator: 4 suits x (digits 0-9 + skip/reverse/draw2).

Digits live in glyphs.py, action symbols in symbols.py. This module draws the
card itself (frame, rim, dithered body, tilted oval) and stamps the face onto it.

Builds one integer pixel grid per card, then emits it as:
  - .svg    run-length-merged rects, crisp edges, scales to any size
  - .png    pure-python encoder (no Pillow)
  - .pixil  Pixilart JSON, PNG embedded as a base64 layer

Tiers:
  16bit -> 32x48,  ~10 flat colors, hard 1px bevel
  32bit -> 64x96,  ~24 colors, dithered vertical gradient, gloss, glyph bevel

Swap COLORWAYS[...] to recolor; layout is color-agnostic.
"""

import base64
import json
import struct
import zlib

import glyphs
import symbols
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "cards"

# ---------------------------------------------------------------- colorways --
# Only the body/ellipse ramps change between colorways. Frame, outline and
# glyph colors are shared so all four suits look like one deck.

NEUTRALS = {
    "SHDW": "#231A1C",
    "FRM_HI": "#FBF7EE",
    "FRM": "#F1EBDD",
    "FRM_SH": "#C4BCAA",
    "BLK": "#1B1215",
    "BLK_SOFT": "#33232A",
    "WHT": "#FFFFFF",
    "WHT_MID": "#FAF6EE",
    "WHT_SH": "#C7BCB0",
}

ROLE_NAMES = {
    "SHDW": "shadow",
    "FRM_HI": "frame-hi",
    "FRM": "frame",
    "FRM_SH": "frame-shade",
    "BLK": "ink",
    "BLK_SOFT": "ink-soft",
    "WHT": "paper",
    "WHT_MID": "paper-mid",
    "WHT_SH": "paper-shade",
    "RIM": "rim",
    "GLOSS": "gloss",
    "MARK": "mark",
    "MARK_HI": "mark-hi",
    "MARK_SH": "mark-shade",
}

COLORWAYS = {
    "red": {
        "RIM": "#6E1216",
        # body ramp, top -> bottom
        "RAMP": ["#E4483F", "#D93A34", "#CE322E", "#BE2A29", "#AC2224", "#951B20"],
        # ellipse ramp, top -> bottom
        "ELL": ["#F76A5B", "#EF564B", "#E4483F"],
        "GLOSS": "#FCA189",
    },
    "yellow": {
        "RIM": "#8A5B08",
        "RAMP": ["#F5CE45", "#EDC034", "#E3B22B", "#D6A222", "#C6911C", "#B27E17"],
        "ELL": ["#FDE375", "#F8D65B", "#F5CE45"],
        "GLOSS": "#FFF0AA",
    },
    "green": {
        "RIM": "#1B5320",
        "RAMP": ["#5BB44E", "#4CA742", "#419A3A", "#368B32", "#2C7B2B", "#236A24"],
        "ELL": ["#7ACE68", "#6AC25B", "#5BB44E"],
        "GLOSS": "#A8E496",
    },
    "blue": {
        "RIM": "#12386E",
        "RAMP": ["#3E7FD4", "#3572C8", "#2E66BB", "#275AAC", "#204D9B", "#1A4188"],
        "ELL": ["#5A9AE8", "#4A8CDE", "#3E7FD4"],
        "GLOSS": "#8FBEF5",
    },
    # The wild cards. Near-black body; the oval reads as a faint grey ring
    # rather than a bright gloss — on the reference it is the only thing keeping
    # the face from being a flat black rectangle.
    "wild": {
        "RIM": "#0A0A0C",
        "RAMP": ["#2B2932", "#26242C", "#211F26", "#1C1B21", "#18171C", "#131217"],
        "ELL": ["#302E38", "#2B2932", "#26242C"],
        "GLOSS": "#4C4957",
    },
}

# The back. Not a suit — it borrows the wild cards' near-black body and the red
# suit's oval, which is what the retail back is: a black card with a red oval on
# it. The only colours new to the deck are the wordmark's.
COLORWAYS["back"] = {
    "RIM": COLORWAYS["wild"]["RIM"],
    "RAMP": COLORWAYS["wild"]["RAMP"],
    # The oval takes red's *body* ramp, not its ellipse ramp. On a red card the
    # ellipse ramp is a highlight and reads as one; on black there is nothing
    # for it to be lighter than, so it just reads as a pink blob. Shifting one
    # step down the ramp — and promoting the old ellipse top tone to GLOSS —
    # puts the oval back at the saturated red the retail back uses, and leaves
    # the ring and crescent somewhere to be brighter than.
    "ELL": COLORWAYS["red"]["RAMP"][0:3],
    "GLOSS": COLORWAYS["red"]["ELL"][0],
    # hi / mid / shade, the same three-part structure the paper ramp gives the
    # digits, so the wordmark takes the deck's bevel instead of reading flat.
    "MARK": ["#FDE375", "#F5CE45", "#C6911C"],
}

# Quadrant colours for the wild symbols: each suit's body mid-tone, so the wheel
# matches the actual cards it stands for.
SUIT_INK = {s: COLORWAYS[s]["RAMP"][1] for s in ("red", "yellow", "green", "blue")}


# ------------------------------------------------------------------ grid ----


class Grid:
    """Indexed pixel buffer. Index 0 is always transparent."""

    def __init__(self, w, h):
        self.w = w
        self.h = h
        self.px = [[0] * w for _ in range(h)]
        self.palette = ["#00000000"]
        self._idx = {"#00000000": 0}
        self.roles = {}  # hex -> semantic name, so CSS can address each part

    def color(self, hexstr):
        if hexstr not in self._idx:
            self._idx[hexstr] = len(self.palette)
            self.palette.append(hexstr)
        return self._idx[hexstr]

    def set(self, x, y, ci):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = ci

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return 0


def compact(g):
    """Drop palette entries the artwork never uses; keep transparent at index 0."""
    used = {g.px[y][x] for y in range(g.h) for x in range(g.w)}
    order = [0] + sorted(used - {0})
    remap = {old: i for i, old in enumerate(order)}
    out = Grid(g.w, g.h)
    out.roles = dict(g.roles)  # keyed by hex, so reindexing doesn't matter
    out.palette = [g.palette[i] for i in order]
    out._idx = {c: i for i, c in enumerate(out.palette)}
    for y in range(g.h):
        for x in range(g.w):
            out.px[y][x] = remap[g.px[y][x]]
    return out


def rgba(hexstr):
    s = hexstr.lstrip("#")
    if len(s) == 8:
        return tuple(int(s[i : i + 2], 16) for i in (0, 2, 4, 6))
    return tuple(int(s[i : i + 2], 16) for i in (0, 2, 4)) + (255,)


# ------------------------------------------------------------- primitives ---


def in_rounded_rect(x, y, x0, y0, x1, y1, r):
    """True if (x,y) is inside the rounded rect spanning [x0,x1]x[y0,y1]."""
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    if r <= 0:
        return True
    # nearest corner center
    cx = x0 + r if x < x0 + r else (x1 - r if x > x1 - r else x)
    cy = y0 + r if y < y0 + r else (y1 - r if y > y1 - r else y)
    if cx == x or cy == y:
        return True
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r + r * 0.35


def fill_rounded_rect(g, x0, y0, x1, y1, r, ci):
    for y in range(max(0, y0), min(g.h, y1 + 1)):
        for x in range(max(0, x0), min(g.w, x1 + 1)):
            if in_rounded_rect(x, y, x0, y0, x1, y1, r):
                g.set(x, y, ci)


def rot_ellipse_hit(x, y, cx, cy, a, b, cos_t, sin_t):
    dx, dy = x + 0.5 - cx, y + 0.5 - cy
    u = dx * cos_t + dy * sin_t
    v = -dx * sin_t + dy * cos_t
    return (u * u) / (a * a) + (v * v) / (b * b) <= 1.0


BAYER2 = [[0.0, 0.5], [0.75, 0.25]]


def ramp_index(t, n, x, y, dither):
    """Map t in [0,1] to a ramp index, optionally ordered-dithered."""
    f = t * (n - 1)
    i = int(f)
    if i >= n - 1:
        return n - 1
    if not dither:
        return i if (f - i) < 0.5 else i + 1
    return i + 1 if (f - i) > BAYER2[y % 2][x % 2] else i


# ----------------------------------------------------------------- glyphs ---


def outline_of(pts, thick=1, round_=False):
    """Dilate by `thick` px, minus the glyph itself.

    round_=True uses a disk (Euclidean) instead of a square (Chebyshev), so the
    outline keeps rounded corners rather than boxing off the curves.
    """
    offs = [
        (dx, dy)
        for dy in range(-thick, thick + 1)
        for dx in range(-thick, thick + 1)
        if not round_ or dx * dx + dy * dy <= thick * thick
    ]
    ring = set()
    for x, y in pts:
        for dx, dy in offs:
            p = (x + dx, y + dy)
            if p not in pts:
                ring.add(p)
    return ring


def bbox_of(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def stamp_glyph(g, pts, ox, oy, c_fill, c_out, bevel=None, thick=1, round_=False,
                paint=None):
    """Draw outline ring then fill. bevel=(c_top, c_bottom) shades edges.

    `paint(x, y) -> colour index or None` overrides the fill per pixel; it is
    what lets the wild symbols be multi-coloured. A painted pixel skips the
    bevel, since a bevel across a colour boundary just reads as dirt.
    """
    for x, y in outline_of(pts, thick, round_):
        g.set(ox + x, oy + y, c_out)
    for x, y in pts:
        ci = paint(x, y) if paint else None
        if ci is None:
            ci = c_fill
            if bevel:
                c_top, c_bot = bevel
                if (x, y - 1) not in pts:
                    ci = c_top
                elif (x, y + 1) not in pts:
                    ci = c_bot
        g.set(ox + x, oy + y, ci)


# ------------------------------------------------------------ card builder --


def build_card(tier, way, face, baked_shadow=False):
    hi = tier == "32bit"
    k = 2 if hi else 1

    W, H = 32 * k, 48 * k
    g = Grid(W, H)
    C = {name: g.color(v) for name, v in NEUTRALS.items()}
    C["RIM"] = g.color(way["RIM"])
    C["GLOSS"] = g.color(way["GLOSS"])
    # A colourway may carry its own ink for the centre glyph. Only the back
    # does: its wordmark is yellow, not the deck's paper white.
    mark = way.get("MARK")
    if mark:
        C["MARK_HI"], C["MARK"], C["MARK_SH"] = (g.color(c) for c in mark)
    ramp = [g.color(c) for c in way["RAMP"]]
    ell = [g.color(c) for c in way["ELL"]]
    if not hi:  # flatten the ramps for the 16-bit tier
        ramp = [ramp[1], ramp[1], ramp[1], ramp[4], ramp[4], ramp[4]]
        ell = [ell[1], ell[1], ell[1]]

    # Semantic name per colour, so the SVG emits addressable classes and CSS can
    # recolour or animate a part (e.g. .u-body-* for the suit) without new files.
    for name, idx in C.items():
        g.roles[g.palette[idx]] = ROLE_NAMES.get(name, name.lower())
    for i, idx in enumerate(ramp):
        g.roles.setdefault(g.palette[idx], f"body-{i}")
    for i, idx in enumerate(ell):
        g.roles.setdefault(g.palette[idx], f"oval-{i}")

    border = 2 * k
    r_out = 4 * k

    # 1. drop shadow. Off by default: an opaque baked shadow lands as a black
    # band on whatever card sits underneath in a fan, and it can't animate.
    # Do it in CSS with filter: drop-shadow() instead. See demo.html.
    sh = k if baked_shadow else 0
    cx1, cy1 = W - 1 - sh, H - 1 - sh  # card's bottom-right corner
    if baked_shadow:
        fill_rounded_rect(g, sh, sh, W - 1, H - 1, r_out, C["SHDW"])

    # 2. frame: shaded copy first, light copy shifted up-left -> 1px bottom-right edge
    fill_rounded_rect(g, 0, 0, cx1, cy1, r_out, C["FRM_SH"])
    fill_rounded_rect(g, 0, 0, cx1 - k, cy1 - k, r_out, C["FRM"])
    if hi:
        fill_rounded_rect(g, 0, 0, cx1 - k, cy1 - k, r_out, C["FRM_HI"])
        fill_rounded_rect(g, 1, 1, cx1 - k, cy1 - k, r_out, C["FRM"])

    # 3. dark inner rim
    bx0, by0 = border, border
    bx1, by1 = cx1 - border, cy1 - border
    fill_rounded_rect(g, bx0, by0, bx1, by1, r_out - k, C["RIM"])

    # 4. body, dithered vertical gradient
    ix0, iy0, ix1, iy1 = bx0 + k, by0 + k, bx1 - k, by1 - k
    body = set()
    for y in range(iy0, iy1 + 1):
        t = (y - iy0) / max(1, (iy1 - iy0))
        for x in range(ix0, ix1 + 1):
            if in_rounded_rect(x, y, ix0, iy0, ix1, iy1, r_out - 2 * k):
                g.set(x, y, ramp[ramp_index(t, len(ramp), x, y, hi)])
                body.add((x, y))

    # 5. tilted ellipse highlight, clipped to the body
    # Centre of the *card*, not of the canvas — they differ when a shadow is
    # baked in, and using the canvas centre nudged the art off by a pixel.
    cx, cy = (cx1 + 1) / 2, (cy1 + 1) / 2
    a, b = 8.6 * k, 15.5 * k
    cos_t, sin_t = 0.906, 0.423  # ~25 degrees

    # The colour-change card has no centre glyph: the oval itself is the symbol,
    # quartered into the four suits. Same ellipse, same tilt, same position as
    # every other card — only the fill changes.
    wheel = face in symbols.WHEEL_FACES
    if wheel:
        cross = 1.6 * k
        suit_ci = {n: g.color(h) for n, h in SUIT_INK.items()}
        for x, y in sorted(body):
            if not rot_ellipse_hit(x, y, cx, cy, a + 1.1 * k, b + 1.1 * k,
                                   cos_t, sin_t):
                continue
            if not rot_ellipse_hit(x, y, cx, cy, a, b, cos_t, sin_t):
                g.set(x, y, C["BLK"])  # ink rim instead of the usual gloss ring
                continue
            # Work in the oval's own frame so the cross follows its axes.
            dx_, dy_ = x + 0.5 - cx, y + 0.5 - cy
            u = dx_ * cos_t + dy_ * sin_t
            v = -dx_ * sin_t + dy_ * cos_t
            if abs(u) < cross or abs(v) < cross:
                g.set(x, y, C["BLK"])  # dividing cross
            else:
                g.set(x, y, suit_ci[symbols.quadrant_uv(u, v)])
    else:
        for x, y in sorted(body):
            if rot_ellipse_hit(x, y, cx, cy, a + 1.1 * k, b + 1.1 * k, cos_t, sin_t):
                if not rot_ellipse_hit(x, y, cx, cy, a, b, cos_t, sin_t):
                    g.set(x, y, C["GLOSS"])  # bright 1px ring
                else:
                    t = (y - iy0) / max(1, (iy1 - iy0))
                    g.set(x, y, ell[ramp_index(t, len(ell), x, y, hi)])

    # 5b. 32-bit only: crescent gloss hugging the upper-left arc of the ellipse.
    # Difference of the ellipse with a copy nudged down-right -> even-width crescent.
    if hi and not wheel:
        for x, y in sorted(body):
            inner = rot_ellipse_hit(x, y, cx, cy, a - 1.5, b - 1.5, cos_t, sin_t)
            nudged = rot_ellipse_hit(x, y, cx + 3, cy + 3, a - 1.5, b - 1.5, cos_t, sin_t)
            if inner and not nudged:
                g.set(x, y, C["GLOSS"])

    # 6. big centered "1"
    outline_w = k  # keep outline weight constant relative to card size
    if not hi:
        raise NotImplementedError(
            "the 16-bit tier has no digit set — glyphs.py is authored at "
            "cap height 32, which only fits the 32-bit card"
        )
    # Symbol functions may return a 4th element, paint(x, y) -> role name, for
    # the multi-coloured wild faces. Resolve those role names to palette indices
    # once, here, so the symbol module stays free of palette knowledge.
    suit_ci = {name: g.color(hexv) for name, hexv in SUIT_INK.items()}
    suit_ci["ink"] = C["BLK"]
    # Give them stable role names. Without this they fall back to u-c<index>,
    # and the index differs per card — the same red would be u-c14 on one wild
    # card and u-c17 on the other, so no single CSS rule could target it.
    for name, hexv in SUIT_INK.items():
        g.roles.setdefault(hexv, f"suit-{name}")

    def _resolve(spec):
        pts, w_, h_ = spec[0], spec[1], spec[2]
        raw = spec[3] if len(spec) > 3 else None
        def fn(x, y, _raw=raw):
            role = _raw(x, y)
            # None is part of the contract: "use the default paper fill". The
            # mini cards' white borders rely on it.
            return None if role is None else suit_ci[role]

        if raw is None:
            fn = None
        return pts, w_, h_, fn

    if isinstance(face, int):
        big_fn = lambda: glyphs.digit(face)
    else:
        big_fn = symbols.FACES[face][0]

    # big_fn is None only for the wheel faces, whose symbol is the oval itself.
    if big_fn is not None:
        big, bw, bh, big_paint = _resolve(big_fn())

        # Centre on the *inked* bbox (glyph plus its outline), not the nominal
        # box — they differ whenever the glyph is asymmetric, which is what
        # threw the old centring off. Centre on the card centre, not the
        # ellipse centre (which sits 1px high).
        # Square (Chebyshev) outline: the reference outline steps squarely with
        # the pixels; a round dilation made the old glyph read as soft.
        ow = symbols.CENTER_OUTLINE.get(face, outline_w)
        ink = big | outline_of(big, ow)
        gx0, gy0, gx1, gy1 = bbox_of(ink)
        ox = round(cx - (gx0 + gx1 + 1) / 2)
        oy = round(cy - (gy0 + gy1 + 1) / 2)
        if mark:
            fill, bevel = C["MARK"], (C["MARK_HI"], C["MARK_SH"])
        else:
            fill = C["WHT_MID"] if hi else C["WHT"]
            bevel = (C["WHT"], C["WHT_SH"]) if hi else None
        stamp_glyph(
            g, big, ox, oy, fill, C["BLK"],
            bevel=bevel, thick=ow, paint=big_paint,
        )

    # 7. corner digits. Both upright — the reference sheet does not rotate the
    # bottom-right one. Kept clear of the border.
    if face in symbols.NO_CORNER:
        return g

    if isinstance(face, int):
        sm, sw, sh, sm_paint = _resolve(glyphs.small_digit(face))
    else:
        sm, sw, sh, sm_paint = _resolve(symbols.FACES[face][1]())
    sm_out = 1  # hairline outline so it reads as minimal

    # Inset from the inner body edge so the digit sits on the colour, never on
    # the frame. sm_out accounts for the outline ring extending past the glyph.
    inset = 2 * k
    stamp_glyph(g, sm, ix0 + inset + sm_out, iy0 + inset + sm_out,
                C["WHT"], C["BLK"], thick=sm_out, paint=sm_paint)
    stamp_glyph(g, sm,
                ix1 - inset - sm_out - sw + 1, iy1 - inset - sm_out - sh + 1,
                C["WHT"], C["BLK"], thick=sm_out, paint=sm_paint)

    return g


# ----------------------------------------------------------------- writers --


def merge_rects(g):
    """Greedy maximal-rectangle decomposition of the grid.

    One <rect> per pixel-run leaves thousands of shared edges; under a fractional
    CSS transform each snaps independently and hairline seams show through.
    Merging into big disjoint rectangles (then one path per colour) removes
    almost all internal edges, and shrinks the file by an order of magnitude.
    """
    done = [[False] * g.w for _ in range(g.h)]
    out = []
    for y in range(g.h):
        for x in range(g.w):
            if done[y][x]:
                continue
            ci = g.px[y][x]
            if ci == 0:
                done[y][x] = True
                continue
            w = 1
            while x + w < g.w and not done[y][x + w] and g.px[y][x + w] == ci:
                w += 1
            h = 1
            while y + h < g.h and all(
                not done[y + h][xx] and g.px[y + h][xx] == ci
                for xx in range(x, x + w)
            ):
                h += 1
            for yy in range(y, y + h):
                for xx in range(x, x + w):
                    done[yy][xx] = True
            out.append((ci, x, y, w, h))
    return out


def write_svg(g, path, name):
    """One <path> per colour, each with a semantic class.

    No width/height attributes: the viewBox is exactly the card, so CSS owns the
    size and transform-origin lands on the real centre — which is what a fan
    layout and a hover lift both need.
    """
    rects = merge_rects(g)
    by_color = {}
    for ci, x, y, w, h in rects:
        by_color.setdefault(ci, []).append((x, y, w, h))

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {g.w} {g.h}" '
        f'shape-rendering="crispEdges" role="img" aria-label="{name}">',
        f"<title>{name}</title>",
    ]
    for ci in sorted(by_color):
        hexc = g.palette[ci]
        role = g.roles.get(hexc, f"c{ci}")
        d = "".join(f"M{x} {y}h{w}v{h}h{-w}z" for x, y, w, h in by_color[ci])
        parts.append(f'<path class="u-{role}" fill="{hexc}" d="{d}"/>')
    parts.append("</svg>")
    path.write_text("\n".join(parts), encoding="utf-8")
    return len(rects), len(by_color)


def png_bytes(g):
    pal = [rgba(c) for c in g.palette]
    raw = bytearray()
    for y in range(g.h):
        raw.append(0)  # filter type 0
        for x in range(g.w):
            raw.extend(pal[g.px[y][x]])

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", g.w, g.h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def write_pixil(g, path, name, png):
    doc = {
        "app": "pixilart",
        "version": "1.0",
        "name": name,
        "width": g.w,
        "height": g.h,
        "frames": [
            {
                "index": 0,
                "name": "Frame 1",
                "delay": 100,
                "hidden": False,
                "layers": [
                    {
                        "index": 0,
                        "name": "Layer 1",
                        "opacity": 100,
                        "hidden": False,
                        "locked": False,
                        "blend": "normal",
                        "src": "data:image/png;base64,"
                        + base64.b64encode(png).decode("ascii"),
                    }
                ],
            }
        ],
        "palette": [c for c in g.palette if c != "#00000000"],
    }
    path.write_text(json.dumps(doc), encoding="utf-8")


# -------------------------------------------------------------------- main --

if __name__ == "__main__":
    # Scope for now: 32-bit only, SVG only. Flip these to re-enable the rest;
    # png_bytes()/write_pixil() are still here and still work.
    SUITS = ("red", "yellow", "green", "blue")
    FACES = list(range(10)) + ["skip", "reverse", "draw2"]
    # The wild cards have no suit of their own; they get their own colourway
    # and only two faces, so they cannot go through the loop above.
    WILD_DECK = ("wild", symbols.WILD_FACES)
    TIER = "32bit"
    EMIT_PNG = False
    EMIT_PIXIL = False

    OUT = OUT_DIR / "svg"
    OUT.mkdir(exist_ok=True)

    total = 0
    for suit in SUITS:
        line = []
        for n in FACES:
            g = compact(build_card(TIER, COLORWAYS[suit], n))
            stem = f"uno-{suit}-{n}"
            name = f"UNO {suit} {n}"
            rects, paths = write_svg(g, OUT / f"{stem}.svg", name)
            if EMIT_PNG or EMIT_PIXIL:
                png = png_bytes(g)
                if EMIT_PNG:
                    (OUT / f"{stem}.png").write_bytes(png)
                if EMIT_PIXIL:
                    write_pixil(g, OUT / f"{stem}.pixil", name, png)
            line.append(f"{n}:{rects}r")
            total += 1
        print(f"{suit:7s} " + "  ".join(line))

    wsuit, wfaces = WILD_DECK
    line = []
    for f_ in wfaces:
        g = compact(build_card(TIER, COLORWAYS[wsuit], f_))
        stem = f"uno-{wsuit}-{f_}"
        rects, paths = write_svg(g, OUT / f"{stem}.svg", f"UNO {wsuit} {f_}")
        line.append(f"{f_}:{rects}r")
        total += 1
    print(f"{wsuit:7s} " + "  ".join(line))

    # The back. One file, no suit, no face variants.
    g = compact(build_card(TIER, COLORWAYS["back"], "back"))
    rects, paths = write_svg(g, OUT / "uno-back.svg", "NUO back")
    total += 1
    print(f"{'back':7s} back:{rects}r")

    print(f"\n{total} cards -> {OUT}/")
