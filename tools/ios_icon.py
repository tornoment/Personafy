"""Значок и заставка iPhone-версии из app/build/icon.png.

Значок iOS — квадрат без прозрачности (система сама скругляет углы), поэтому цилиндр
кладётся на чёрный фон с красной косой полосой в стиле P5. Заставка — тот же цилиндр
поменьше на чёрном.

    python3 tools/ios_icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'app' / 'build' / 'icon.png'
ASSETS = ROOT / 'mobile' / 'ios' / 'App' / 'App' / 'Assets.xcassets'
BLACK = (11, 11, 11)
RED = (212, 20, 26)
DARK_RED = (94, 7, 12)


def hat(size):
    im = Image.open(SRC).convert('RGBA')
    box = im.getbbox()
    im = im.crop(box)
    k = size / max(im.size)
    return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)


def icon():
    n = 1024
    bg = Image.new('RGB', (n, n), BLACK)
    d = ImageDraw.Draw(bg)
    # dots like the player's backgrounds
    for y in range(0, n, 26):
        for x in range((y // 26) % 2 * 13, n, 26):
            d.ellipse((x - 2.6, y - 2.6, x + 2.6, y + 2.6), fill=(30, 30, 30))
    # dark shard behind, red slash across
    d.polygon([(560, 0), (n, 0), (n, 470), (700, 560), (780, 330)], fill=DARK_RED)
    d.polygon([(0, 610), (n, 250), (n, 470), (0, 860)], fill=RED)
    d.polygon([(0, 590), (n, 232), (n, 246), (0, 604)], fill=(255, 255, 255))
    h = hat(820)
    shadow = Image.new('RGBA', h.size, (0, 0, 0, 0))
    shadow.putalpha(h.getchannel('A').point(lambda a: 200 if a > 40 else 0))
    shadow = shadow.filter(ImageFilter.GaussianBlur(2))
    x = (n - h.width) // 2 + 6
    y = (n - h.height) // 2 + 10
    out = bg.convert('RGBA')
    out.alpha_composite(shadow, (x + 18, y + 22))
    out.alpha_composite(h, (x, y))
    out.convert('RGB').save(ASSETS / 'AppIcon.appiconset' / 'AppIcon-512@2x.png', optimize=True)


def splash():
    n = 2732
    bg = Image.new('RGBA', (n, n), BLACK + (255,))
    h = hat(560)
    bg.alpha_composite(h, ((n - h.width) // 2, (n - h.height) // 2))
    out = bg.convert('RGB')
    for name in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
        out.save(ASSETS / 'Splash.imageset' / name, optimize=True)


if __name__ == '__main__':
    icon()
    splash()
    print('ok')
