"""Значок, заставка Android-версии из app/build/icon.png — тот же рисунок, что у iPhone (tools/ios_icon.py).

Android-значок «адаптивный»: фон (точки, тёмный осколок, красная косая полоса) и цилиндр отдельными
слоями, система сама вырезает форму (круг, квадрат со скруглением…) и может слегка двигать слои.
Слой 108dp, видно примерно 72dp посередине — рисунок iPhone-значка ложится ровно в эти 72dp, а края
дорисованы продолжением полос. Ещё: одноцветный цилиндр для «тематических» значков Android 13+,
обычные квадратный и круглый значки для Android 7, цилиндр для заставки.

    python3 tools/android_icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from ios_icon import BLACK, DARK_RED, RED, hat

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'mobile' / 'android' / 'app' / 'src' / 'main' / 'res'
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
N = 1024             # the iPhone icon's drawing = the visible 72dp
M = N * 18 // 72     # 18dp of margin on each side → 108dp layer
L = N + 2 * M        # 1536


def extend(points):
    """iPhone-icon coordinates → layer coordinates."""
    return [(x + M, y + M) for x, y in points]


def background():
    bg = Image.new('RGB', (L, L), BLACK)
    d = ImageDraw.Draw(bg)
    for y in range(-M - M % 26, N + M, 26):
        for x in range(((y // 26) % 2) * 13 - M - M % 26, N + M, 26):
            cx, cy = x + M, y + M
            d.ellipse((cx - 2.6, cy - 2.6, cx + 2.6, cy + 2.6), fill=(30, 30, 30))

    def line_y(p, q, x):
        return p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0])

    # dark shard (its top and right edges carried on to the layer's edge)
    d.polygon(extend([(389, -M), (N + M, -M), (N + M, 399), (700, 560), (780, 330)]), fill=DARK_RED)
    # red slash and its white edge: the same bands, longer
    lo, hi = -M, N + M
    for (a, b), (c, e), col in (
        (((0, 610), (N, 250)), ((N, 470), (0, 860)), RED),
        (((0, 590), (N, 232)), ((N, 246), (0, 604)), (255, 255, 255)),
    ):
        pts = [(lo, line_y(a, b, lo)), (hi, line_y(a, b, hi)), (hi, line_y(e, c, hi)), (lo, line_y(e, c, lo))]
        d.polygon(extend(pts), fill=col)
    return bg


def foreground():
    out = Image.new('RGBA', (L, L), (0, 0, 0, 0))
    h = hat(740)   # a little smaller than on the iPhone: Android may cut the icon to a circle
    shadow = Image.new('RGBA', h.size, (0, 0, 0, 0))
    shadow.putalpha(h.getchannel('A').point(lambda a: 200 if a > 40 else 0))
    shadow = shadow.filter(ImageFilter.GaussianBlur(2))
    x = (L - h.width) // 2 + 6
    y = (L - h.height) // 2 + 10
    out.alpha_composite(shadow, (x + 18, y + 22))
    out.alpha_composite(h, (x, y))
    return out


def monochrome():
    # the hat's light parts (red, white flames, white outline) solid, its black lines cut out
    h = hat(700)
    a = h.getchannel('A').point(lambda v: 255 if v > 60 else 0)
    r, g, b, _ = h.split()
    light = Image.merge('RGB', (r, g, b)).convert('L', (0.6, 0.3, 0.1, 0)).point(lambda v: 255 if v > 55 else 0)
    mask = Image.composite(light, Image.new('L', h.size, 0), a)
    out = Image.new('RGBA', (L, L), (0, 0, 0, 0))
    white = Image.new('RGBA', h.size, (255, 255, 255, 255))
    out.paste(white, ((L - h.width) // 2, (L - h.height) // 2), mask)
    return out


def rounded(im, r):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=r, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    return out


def circle(im):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).ellipse((0, 0, im.width - 1, im.height - 1), fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    return out


def main():
    bg = background()
    fg = foreground()
    mono = monochrome()
    full = bg.convert('RGBA')
    full.alpha_composite(fg)
    visible = full.crop((M, M, M + N, M + N))
    for name, k in DENSITIES.items():
        d = RES / ('mipmap-' + name)
        d.mkdir(parents=True, exist_ok=True)
        layer = round(108 * k)
        icon = round(48 * k)
        bg.resize((layer, layer), Image.LANCZOS).save(d / 'ic_launcher_background.png', optimize=True)
        fg.resize((layer, layer), Image.LANCZOS).save(d / 'ic_launcher_foreground.png', optimize=True)
        mono.resize((layer, layer), Image.LANCZOS).save(d / 'ic_launcher_monochrome.png', optimize=True)
        small = visible.resize((icon, icon), Image.LANCZOS)
        rounded(small, round(icon * 0.18)).save(d / 'ic_launcher.png', optimize=True)
        circle(small).save(d / 'ic_launcher_round.png', optimize=True)
    # start-up: the hat alone (Android 12+ puts it in a circle on black)
    sp = RES / 'drawable-nodpi'
    sp.mkdir(parents=True, exist_ok=True)
    # (shown at 240dp and cut to a 160dp circle: the hat stays inside that circle)
    h = hat(760)
    splash = Image.new('RGBA', (1800, 1800), (0, 0, 0, 0))
    splash.alpha_composite(h, ((1800 - h.width) // 2, (1800 - h.height) // 2))
    splash.resize((720, 720), Image.LANCZOS).save(sp / 'splash_icon.png', optimize=True)
    # a preview for checking by eye
    return full


if __name__ == '__main__':
    main()
    print('ok')
