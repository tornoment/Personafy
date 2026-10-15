"""Procedural paint textures for the Metaphor-style theme (all original, drawn from noise).

Outputs alpha masks (white RGB + alpha) as WebP into app/src/mf/:
  brush1/2/3.webp  horizontal brush strokes with bristle streaks and dry, broken ends (row / menu highlights)
  swathe1/2.webp   big diagonal paint areas with splattered, torn edges (background paint, recoloured in CSS)
  splat.webp       loose drops and flecks
  scratch.webp     thin white scratches and hairlines
  grain.webp       fine paper/ink grain, tileable
Run: python3 tools/mf_textures.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'mf')
os.makedirs(OUT, exist_ok=True)


def fbm(h, w, scales, rng, weights=None, sx=1.0, sy=1.0):
    """value-noise fBm: random grids upsampled bicubically; sx/sy stretch the grain (streaks)."""
    acc = np.zeros((h, w), np.float32)
    tot = 0.0
    for k, s in enumerate(scales):
        gh = max(2, int(h / (s * sy)))
        gw = max(2, int(w / (s * sx)))
        g = rng.random((gh, gw)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        wgt = weights[k] if weights else 1.0 / (k + 1)
        acc += np.asarray(im, np.float32) / 255.0 * wgt
        tot += wgt
    acc /= tot
    acc -= acc.min()
    acc /= max(1e-6, acc.max())
    return acc


def aniso(h, w, scales, rng, along=20, angle=0.0, weights=None):
    """noise streaked along a direction: stretched grain generated on a larger square, rotated, centre-cropped."""
    d = int(np.ceil(np.hypot(h, w))) + 4
    n = fbm(d, d, scales, rng, weights, sx=along, sy=1)
    im = Image.fromarray((n * 255).astype(np.uint8)).rotate(angle, resample=Image.BICUBIC)
    y0 = (d - h) // 2
    x0 = (d - w) // 2
    return np.asarray(im, np.float32)[y0:y0 + h, x0:x0 + w] / 255.0


def save_mask(alpha, name, blur=0.6, quality=82):
    a = np.clip(alpha, 0, 1)
    im = Image.fromarray((a * 255).astype(np.uint8), 'L')
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    rgba = Image.merge('RGBA', [Image.new('L', im.size, 255)] * 3 + [im])
    rgba.save(os.path.join(OUT, name), 'WEBP', quality=quality, method=6)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def brush(seed, w=1400, h=170, thick=0.62):
    rng = np.random.default_rng(seed)
    y = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    # centre line wanders a little; thickness swells in the middle and thins at the ends
    wob = (fbm(1, w, [w / 3, w / 7], rng)[0] - 0.5) * 0.22
    prof = thick * (0.8 + 0.2 * np.sin(np.pi * np.clip(x * 1.05, 0, 1)))
    # edges torn along the stroke: long in x, short in y
    edge_n = (fbm(h, w, [3, 7, 16], rng, [0.45, 0.35, 0.2], sx=9, sy=1) - 0.5) * 0.42
    d = np.abs(y - wob) - prof + edge_n
    body = smoothstep(0.025, -0.025, d)
    # bristle streaks: long in x, fine in y
    streak = fbm(h, w, [3, 7], rng, [0.6, 0.4], sx=60, sy=1)
    body *= 0.74 + 0.26 * streak
    # dry, broken start and a ragged tail that breaks into bristle lines
    start = smoothstep(0.0, 0.14, x + (streak - 0.5) * 0.2)
    tail_n = fbm(h, w, [3, 8], rng, sx=40, sy=1)
    thr = np.clip((x - 0.68) * 2.4, 0, 1.2)
    dry = smoothstep(thr - 0.04, thr + 0.04, tail_n)
    a = body * start * dry
    return a


def splatter(h, w, rng, n, rmin, rmax, region=None):
    a = np.zeros((h, w), np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(n):
        if region is not None:
            ys, xs = np.nonzero(region)
            k = rng.integers(len(ys))
            cy, cx = ys[k], xs[k]
        else:
            cy, cx = rng.integers(h), rng.integers(w)
        r = rng.uniform(rmin, rmax)
        y0, y1 = max(0, int(cy - r - 2)), min(h, int(cy + r + 3))
        x0, x1 = max(0, int(cx - r - 2)), min(w, int(cx + r + 3))
        sub = np.sqrt((yy[y0:y1, x0:x1] - cy) ** 2 + (xx[y0:y1, x0:x1] - cx) ** 2)
        a[y0:y1, x0:x1] = np.maximum(a[y0:y1, x0:x1], smoothstep(r, r - 1.2, sub))
    return a


def swathe(seed, w=1600, h=1000, angle=-18, cover=0.52):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.deg2rad(angle)
    # distance across the swathe; its edges are torn along the brush direction
    u = ((xx - w / 2) * np.sin(t) + (yy - h / 2) * np.cos(t)) / h
    big = fbm(h, w, [160, 320], rng, [0.6, 0.4])
    tear = aniso(h, w, [4, 10, 26], rng, along=14, angle=-angle, weights=[0.4, 0.35, 0.25])
    edge = np.abs(u + (big - 0.5) * 0.45) - cover / 2 + (tear - 0.5) * 0.16
    a = smoothstep(0.01, -0.01, edge)
    # dragged-brush streaks along the swathe, with a few dry gaps
    streak = aniso(h, w, [3, 7, 18], rng, along=50, angle=-angle, weights=[0.5, 0.3, 0.2])
    a *= 0.78 + 0.22 * streak
    a *= np.where(streak < 0.16, 0.5, 1.0)
    # splatter near the edges
    rim = (np.abs(edge) < 0.04) & (rng.random((h, w)) < 0.004)
    a = np.maximum(a, splatter(h, w, rng, 170, 1.5, 9, rim) * 0.95)
    a = np.maximum(a, splatter(h, w, rng, 40, 1, 3.5) * 0.7)
    # never touch the image border: the paint frays out before the edge, so no straight cut shows when it is placed on screen
    bd = np.minimum(np.minimum(xx, w - 1 - xx) / w, np.minimum(yy, h - 1 - yy) / h)
    fray = aniso(h, w, [5, 12], rng, along=10, angle=-angle)
    a *= smoothstep(0.0, 1.0, (bd / 0.09) + (fray - 0.5) * 0.9 - 0.15)
    return a


def scratches(seed, w=1600, h=1000):
    rng = np.random.default_rng(seed)
    im = Image.new('L', (w, h), 0)
    from PIL import ImageDraw
    dr = ImageDraw.Draw(im)
    for _ in range(14):
        x0 = rng.uniform(-0.2, 1.2) * w
        y0 = rng.uniform(-0.2, 1.2) * h
        ang = np.deg2rad(rng.choice([rng.uniform(-35, -15), rng.uniform(55, 80)]))
        ln = rng.uniform(0.3, 1.1) * w
        x1, y1 = x0 + np.cos(ang) * ln, y0 + np.sin(ang) * ln
        dr.line([(x0, y0), (x1, y1)], fill=int(rng.uniform(110, 230)), width=int(rng.choice([1, 1, 2, 3])))
    # a few long hairline arcs, like construction lines
    for _ in range(3):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(0.35, 0.8) * w
        a0 = rng.uniform(0, 300)
        dr.arc([cx - r, cy - r, cx + r, cy + r], a0, a0 + rng.uniform(40, 120), fill=int(rng.uniform(90, 170)), width=1)
    a = np.asarray(im, np.float32) / 255.0
    a = np.maximum(a, splatter(h, w, rng, 70, 0.8, 2.6) * 0.75)
    return a


def grain(seed, n=256):
    rng = np.random.default_rng(seed)
    g = rng.random((n, n)).astype(np.float32)
    g = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255.0
    return np.clip((g - 0.5) * 2.4 + 0.5, 0, 1) * 0.5


if __name__ == '__main__':
    import sys
    if 'swathe' in sys.argv:
        save_mask(swathe(5, angle=-20, cover=0.55), 'swathe1.webp', blur=0.8, quality=78)
        save_mask(swathe(9, angle=24, cover=0.42), 'swathe2.webp', blur=0.8, quality=78)
        sys.exit(0)
    save_mask(brush(11), 'brush1.webp')
    save_mask(brush(23, thick=0.55), 'brush2.webp')
    save_mask(brush(37, w=900, h=150, thick=0.66), 'brush3.webp')
    save_mask(swathe(5, angle=-20, cover=0.55), 'swathe1.webp', blur=0.8, quality=78)
    save_mask(swathe(9, angle=24, cover=0.42), 'swathe2.webp', blur=0.8, quality=78)
    rng = np.random.default_rng(3)
    sp = splatter(800, 1200, rng, 260, 1, 7)
    sp = np.maximum(sp, splatter(800, 1200, rng, 12, 10, 22) * 0.9)
    save_mask(sp, 'splat.webp', blur=0.5)
    save_mask(scratches(17), 'scratch.webp', blur=0.35, quality=85)
    save_mask(grain(4), 'grain.webp', blur=0, quality=70)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))
