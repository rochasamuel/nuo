"""Digit glyphs 0-9 in the reference typeface.

Shared metrics, which is what makes them read as one typeface:
    cap height   32 px
    stroke       6 px
    chamfer      4 px on outer corners, 2 px on counters
    counters     8 px wide

0, 1, 2, 3 and 4 were traced from the reference sheet (white mask extracted per
card, resampled to cap height 32). 5, 6, 7, 8 and 9 are drawn to the same
metrics, since the sheet only showed those five digits.

Each glyph is a list of (y0, y1, [(x0, x1), ...]) row bands, inclusive on both
ends. Bands are easier to keep consistent than 32 lines of ASCII per digit.
"""


def _spans_to_pts(w, h, bands):
    pts = set()
    for y0, y1, spans in bands:
        for y in range(y0, y1 + 1):
            for x0, x1 in spans:
                for x in range(x0, x1 + 1):
                    pts.add((x, y))
    assert all(0 <= x < w and 0 <= y < h for x, y in pts), "glyph escapes its box"
    return pts


# -- 0 : chamfered ring, traced ------------------------------------------------
D0 = (22, [
    (0, 0, [(4, 17)]), (1, 1, [(3, 18)]), (2, 2, [(2, 19)]), (3, 3, [(1, 20)]),
    (4, 5, [(0, 21)]),
    (6, 6, [(0, 8), (13, 21)]),
    (7, 7, [(0, 7), (14, 21)]),
    (8, 23, [(0, 6), (15, 21)]),
    (24, 24, [(0, 7), (14, 21)]),
    (25, 25, [(0, 8), (13, 21)]),
    (26, 27, [(0, 21)]),
    (28, 28, [(1, 20)]), (29, 29, [(2, 19)]), (30, 30, [(3, 18)]),
    (31, 31, [(4, 17)]),
])

# -- 1 : stem + flag + base serif, traced --------------------------------------
D1 = (18, [
    (0, 1, [(6, 13)]),
    (2, 2, [(4, 13)]),
    (3, 3, [(2, 13)]),
    (4, 9, [(0, 13)]),
    (10, 25, [(6, 13)]),
    (26, 31, [(2, 17)]),
])

# -- 2 : bowl, diagonal, flat base, traced -------------------------------------
D2 = (19, [
    (0, 0, [(3, 15)]), (1, 1, [(2, 16)]), (2, 2, [(1, 17)]),
    (3, 5, [(0, 18)]),
    (6, 8, [(0, 5), (13, 18)]),
    (9, 11, [(13, 18)]),
    (12, 12, [(12, 18)]),
    (13, 13, [(10, 18)]),
    (14, 14, [(9, 17)]), (15, 15, [(8, 16)]), (16, 16, [(7, 15)]),
    (17, 17, [(6, 14)]), (18, 18, [(5, 13)]), (19, 19, [(4, 12)]),
    (20, 20, [(3, 11)]), (21, 21, [(2, 10)]), (22, 22, [(1, 9)]),
    (23, 25, [(0, 8)]),
    (26, 31, [(0, 18)]),
])

# -- 3 : two bowls, traced -----------------------------------------------------
D3 = (19, [
    (0, 0, [(3, 15)]), (1, 1, [(2, 16)]), (2, 2, [(1, 17)]),
    (3, 5, [(0, 18)]),
    (6, 6, [(0, 6), (13, 18)]),
    (7, 8, [(0, 5), (13, 18)]),
    (9, 11, [(13, 18)]),
    (12, 12, [(12, 18)]),
    # Middle bar starts at col 8, not col 6. That extra indent is what keeps the
    # left side open across rows 9-18 — pull it left and the counters close up
    # and the glyph reads as an 8.
    (13, 18, [(8, 18)]),
    (19, 21, [(13, 18)]),
    (22, 22, [(0, 6), (13, 18)]),
    (23, 25, [(0, 5), (13, 18)]),
    (26, 28, [(0, 18)]),
    (29, 29, [(1, 17)]), (30, 30, [(2, 16)]), (31, 31, [(3, 15)]),
])

# -- 4 : diagonal + stem + crossbar, traced ------------------------------------
D4 = (21, [
    (0, 1, [(12, 17)]),
    (2, 2, [(11, 17)]), (3, 3, [(10, 17)]), (4, 4, [(9, 17)]),
    (5, 6, [(8, 17)]), (7, 7, [(7, 17)]), (8, 8, [(6, 17)]),
    (9, 9, [(6, 10), (12, 17)]),
    (10, 10, [(5, 10), (12, 17)]),
    (11, 11, [(5, 9), (12, 17)]),
    (12, 13, [(4, 9), (12, 17)]),
    (14, 15, [(3, 8), (12, 17)]),
    (16, 17, [(2, 7), (12, 17)]),
    (18, 18, [(1, 6), (12, 17)]),
    (19, 19, [(0, 6), (12, 17)]),
    (20, 24, [(0, 20)]),
    (25, 31, [(12, 17)]),
])

# -- 5 : flat top bar, left wall, lower bowl -----------------------------------
D5 = (19, [
    (0, 5, [(0, 18)]),
    (6, 12, [(0, 5)]),
    (13, 18, [(0, 18)]),
    (19, 22, [(13, 18)]),
    (23, 25, [(0, 5), (13, 18)]),
    (26, 28, [(0, 18)]),
    (29, 29, [(1, 17)]), (30, 30, [(2, 16)]), (31, 31, [(3, 15)]),
])

# -- 6 : shoulder top-right, closed lower bowl ---------------------------------
D6 = (19, [
    (0, 0, [(4, 16)]), (1, 1, [(3, 17)]), (2, 2, [(2, 18)]), (3, 3, [(1, 18)]),
    (4, 5, [(0, 18)]),
    (6, 12, [(0, 5)]),
    (13, 18, [(0, 18)]),
    (19, 25, [(0, 5), (13, 18)]),
    (26, 28, [(0, 18)]),
    (29, 29, [(1, 17)]), (30, 30, [(2, 16)]), (31, 31, [(3, 15)]),
])

# -- 7 : top bar + long diagonal -----------------------------------------------
D7 = (19, [
    (0, 5, [(0, 18)]),
    (6, 8, [(12, 17)]),
    (9, 11, [(11, 16)]),
    (12, 14, [(10, 15)]),
    (15, 17, [(9, 14)]),
    (18, 20, [(8, 13)]),
    (21, 23, [(7, 12)]),
    (24, 26, [(6, 11)]),
    (27, 29, [(5, 10)]),
    (30, 31, [(4, 9)]),
])

# -- 8 : two closed bowls ------------------------------------------------------
D8 = (19, [
    (0, 0, [(3, 15)]), (1, 1, [(2, 16)]), (2, 2, [(1, 17)]),
    (3, 5, [(0, 18)]),
    (6, 12, [(0, 5), (13, 18)]),
    (13, 18, [(0, 18)]),
    (19, 25, [(0, 5), (13, 18)]),
    (26, 28, [(0, 18)]),
    (29, 29, [(1, 17)]), (30, 30, [(2, 16)]), (31, 31, [(3, 15)]),
])

# -- 9 : closed upper bowl, shoulder bottom-left (6 rotated) -------------------
D9 = (19, [
    (0, 0, [(3, 15)]), (1, 1, [(2, 16)]), (2, 2, [(1, 17)]),
    (3, 5, [(0, 18)]),
    (6, 12, [(0, 5), (13, 18)]),
    (13, 18, [(0, 18)]),
    (19, 25, [(13, 18)]),
    (26, 27, [(0, 18)]),
    (28, 28, [(0, 17)]), (29, 29, [(1, 16)]), (30, 30, [(2, 15)]),
    (31, 31, [(3, 14)]),
])

_SPECS = [D0, D1, D2, D3, D4, D5, D6, D7, D8, D9]
HEIGHT = 32


def digit(n):
    """Return (points, width, height) for digit n."""
    w, bands = _SPECS[n]
    return _spans_to_pts(w, HEIGHT, bands), w, HEIGHT


# -- corner digits -------------------------------------------------------------
# Thin companion face, 6x9, 2px strokes. Not a downscale of the big digits —
# at this size that turns to mush — but drawn to echo them: the "1" carries the
# same base serif, the "4" the same closed counter.

SMALL = [
    [".####.",
     "######",
     "##..##",
     "##..##",
     "##..##",
     "##..##",
     "##..##",
     "######",
     ".####."],

    ["..##..",
     ".###..",
     "####..",
     "..##..",
     "..##..",
     "..##..",
     "..##..",
     "..##..",
     "######"],

    [".####.",
     "##..##",
     "....##",
     "...##.",
     "..##..",
     ".##...",
     "##....",
     "######",
     "######"],

    [".####.",
     "##..##",
     "....##",
     ".####.",
     "....##",
     "....##",
     "....##",
     "##..##",
     ".####."],

    ["....##",
     "...###",
     "..####",
     ".##.##",
     "##..##",
     "######",
     "######",
     "....##",
     "....##"],

    ["######",
     "##....",
     "##....",
     "#####.",
     "....##",
     "....##",
     "....##",
     "##..##",
     ".####."],

    ["..####",
     ".##...",
     "##....",
     "#####.",
     "##..##",
     "##..##",
     "##..##",
     "##..##",
     ".####."],

    ["######",
     "######",
     "....##",
     "...##.",
     "...##.",
     "..##..",
     "..##..",
     ".##...",
     ".##..."],

    [".####.",
     "##..##",
     "##..##",
     ".####.",
     ".####.",
     "##..##",
     "##..##",
     "##..##",
     ".####."],

    [".####.",
     "##..##",
     "##..##",
     ".#####",
     "....##",
     "....##",
     "....##",
     "...##.",
     ".###.."],
]


def small_digit(n):
    """Return (points, width, height) for the corner version of digit n."""
    rows = SMALL[n]
    pts = {(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c != "."}
    return pts, len(rows[0]), len(rows)


# -- letters -------------------------------------------------------------------
# Only U, N and O exist, because the back is the only card with a word on it.
# Half-scale of the digit metrics, near enough that they read as the same
# typeface one size down:
#
#     cap height  18   (digits 32)
#     stroke       4   (digits 6)
#     counter      4   (digits 8)
#     chamfer      2 on outer corners, 1 on counters   (digits 4 / 2)
#
# The size is not a taste call. The wordmark is stamped rotated 25 degrees, and
# a rotation costs width: the tilted bounding box is w*cos + h*sin. At cap 18
# the word lands at ~48px across, which is the widest that still clears the
# card body's 52px inner width on both sides. Cap 20 overflows onto the rim.

LETTER_H = 18

# -- U : two stems into a chamfered bowl ---------------------------------------
LU = (12, [
    (0, 12, [(0, 3), (8, 11)]),
    (13, 13, [(0, 4), (7, 11)]),
    (14, 15, [(0, 11)]),
    (16, 16, [(1, 10)]),
    (17, 17, [(2, 9)]),
])

# -- O : chamfered ring, the U closed at the top -------------------------------
LO = (12, [
    (0, 0, [(2, 9)]),
    (1, 1, [(1, 10)]),
    (2, 3, [(0, 11)]),
    (4, 4, [(0, 4), (7, 11)]),
    (5, 12, [(0, 3), (8, 11)]),
    (13, 13, [(0, 4), (7, 11)]),
    (14, 15, [(0, 11)]),
    (16, 16, [(1, 10)]),
    (17, 17, [(2, 9)]),
])

# -- N : two stems joined by a diagonal ----------------------------------------
# The diagonal is 3px, not 4 like the stems. At 4 it meets each stem across two
# full rows and the counters seal shut into a solid black waist; 3 keeps a
# 1px gap open, which the outline pass then closes cleanly at the junction only.
LN = (12, [
    (0, 2, [(0, 3), (8, 11)]),
    (3, 4, [(0, 4), (8, 11)]),
    (5, 6, [(0, 5), (8, 11)]),
    (7, 8, [(0, 6), (8, 11)]),
    (9, 10, [(0, 3), (5, 11)]),
    (11, 12, [(0, 3), (6, 11)]),
    (13, 14, [(0, 3), (7, 11)]),
    (15, 17, [(0, 3), (8, 11)]),
])

_LETTERS = {"U": LU, "N": LN, "O": LO}

TRACKING = 3
# 3px, not less: each letter carries a 1px outline ring, so at tracking 2 the
# rings of neighbouring letters touch and the word gets welded together by a
# black bridge. 3 leaves a 1px gap of oval showing between them.


def letter(ch):
    """Return (points, width, height) for one letter."""
    w, bands = _LETTERS[ch]
    return _spans_to_pts(w, LETTER_H, bands), w, LETTER_H


def word(text, tracking=TRACKING):
    """Return (points, width, height) for a string, set on one baseline."""
    pts = set()
    x = 0
    for ch in text:
        p, w, _ = letter(ch)
        pts |= {(px + x, py) for px, py in p}
        x += w + tracking
    return pts, x - tracking, LETTER_H
