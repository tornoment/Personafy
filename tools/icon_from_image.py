"""Turn the sticker picture (light-grey background) into a transparent app icon (.ico + .png)."""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

src, out_dir = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(int)
bg = np.median(np.concatenate([a[:20, :20].reshape(-1, 3), a[-20:, -20:].reshape(-1, 3)]), axis=0)

art = np.abs(a - bg).max(axis=2) > 45                       # red / black artwork
lab, n = ndi.label(art)
art = lab == (np.argmax(ndi.sum(art, lab, range(1, n + 1))) + 1)
white = a.min(axis=2) >= bg.max() + 3.5                      # sticker border is whiter than the background
mask = art | white
lab, n = ndi.label(mask)
keep = np.unique(lab[art])
mask = np.isin(lab, keep[keep > 0])
mask = ndi.binary_fill_holes(mask)
mask = ndi.binary_closing(mask, iterations=3)
mask = ndi.binary_opening(mask, iterations=2)
mask = ndi.binary_fill_holes(mask)

rgb = a.copy()
ring = mask & ~ndi.binary_dilation(art, iterations=1) & (a.min(axis=2) > 225)
rgb[ring] = 255                                              # clean, pure white sticker edge

# thin black outline outside the white edge so the icon reads on light taskbars too
outline = ndi.binary_dilation(mask, iterations=9) & ~mask
full = mask | outline
rgb[outline] = 11

alpha = Image.fromarray((full * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
rgba = Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).convert('RGBA')
rgba.putalpha(alpha)

ys, xs = np.nonzero(full)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
side = int(max(x1 - x0, y1 - y0) * 1.04)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
canvas.paste(rgba.crop((x0, y0, x1, y1)), (cx - side // 2 - x0 + x0 - (cx - side // 2) + (side - (x1 - x0)) // 2 - 0, (side - (y1 - y0)) // 2))
big = canvas.resize((1024, 1024), Image.LANCZOS)
big.resize((512, 512), Image.LANCZOS).save(out_dir + '/icon.png')
big.resize((256, 256), Image.LANCZOS).save(out_dir + '/icon-256.png')
big.save(out_dir + '/icon.ico', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])
print('icon written', big.size)
