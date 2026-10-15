import math, sys
from PIL import Image, ImageDraw

S = 1024
def bez(p0, p1, p2, p3, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3; b = 3 * (1 - t) ** 2 * t; c = 3 * (1 - t) * t * t; d = t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out

def star(cx, cy, r1, r2, n, rot, jitter):
    pts = []
    for i in range(n * 2):
        ang = rot + math.pi * i / n
        r = (r1 if i % 2 == 0 else r2) * (1 + jitter[i % len(jitter)])
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
jit = [0.0, 0.06, -0.05, 0.03, 0.08, -0.02, 0.04, -0.06, 0.02, 0.07, -0.03, 0.05]
d.polygon(star(512, 512, 505, 330, 12, -0.2, jit), fill=(11, 11, 11, 255))
d.polygon(star(512, 512, 455, 300, 12, -0.2, jit), fill=(212, 20, 26, 255))
d.polygon(star(512, 512, 330, 230, 12, 0.05, jit[::-1]), fill=(11, 11, 11, 255))

# note in a 70x80 box -> scale and place
sc = 8.6; ox = 512 - 37 * sc; oy = 512 - 44 * sc
def T(p): return (ox + p[0] * sc, oy + p[1] * sc)

def ellipse_poly(cx, cy, rx, ry, rot_deg, n=64):
    r = math.radians(rot_deg); out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        x = rx * math.cos(a); y = ry * math.sin(a)
        out.append((cx + x * math.cos(r) - y * math.sin(r), cy + x * math.sin(r) + y * math.cos(r)))
    return out

head = ellipse_poly(26, 60, 16, 12, -20)
stem = [(37, 12), (44, 12), (44, 60), (37, 60)]
flag = [(40, 12)] + bez((40, 12), (53, 13), (65, 22), (60, 40)) + bez((60, 40), (57, 31), (50, 26), (42, 26))
shapes = [head, stem, flag]

def outline(shapes, width, color):
    for sh in shapes:
        pts = [T(p) for p in sh]
        d.polygon(pts, fill=color)
        d.line(pts + [pts[0]], fill=color, width=int(width * sc), joint='curve')
        for p in pts:
            r = width * sc / 2
            d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=color)

outline(shapes, 7, (11, 11, 11, 255))
for sh in shapes:
    d.polygon([T(p) for p in sh], fill=(255, 255, 255, 255))

out = sys.argv[1]
big = img.resize((512, 512), Image.LANCZOS)
big.save(out + '/icon.png')
img.save(out + '/icon.ico', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])
img.resize((256, 256), Image.LANCZOS).save(out + '/icon-256.png')
print('ok')
