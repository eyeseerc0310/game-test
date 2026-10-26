# Turn an upscaled pixel-art image back into its true pixels, as code.
# 1. Find the pixel grid: how many screen px one art pixel spans, and where
#    the grid lines fall (from where colour changes between neighbours).
# 2. For each art pixel, look around where its middle should be for the
#    flattest spot (AI-made images drift off a perfect grid by up to half a
#    pixel) and read the median colour there.
# 3. Fit all pixels to one palette that keeps rare colours (flames, water).
# 4. Write a JS file: the palette and one string per row, two hex digits
#    (a palette index) per pixel.
# Usage: python3 tools/image_to_pixels.py <image.png> <out.js> <JS_NAME> [colours] [--grid PX PY]
# --grid forces the pixel size (image px per pixel across and down) instead of
# finding it, so rooms painted at different pixel sizes can share one: each
# pixel then takes the median colour of the area it covers.
import sys
import numpy as np
from PIL import Image

args = sys.argv[1:]
forced = None
if '--grid' in args:
    k = args.index('--grid')
    forced = (float(args[k + 1]), float(args[k + 2]))
    del args[k:k + 3]
src, out_js, name = args[:3]
n_colours = int(args[3]) if len(args) > 3 else 256
a = np.asarray(Image.open(src).convert('RGB')).astype(float)
H, W, _ = a.shape


def fit_grid(change):
    """Period and grid-line offset that best explain where colour changes."""
    sig = change - change.mean()
    idx = np.arange(len(sig)) + 0.5  # a change sits between pixel i and i + 1
    best = (0, 0, 0)
    for p in np.arange(3.0, 12.0, 0.002):
        z = (sig * np.exp(2j * np.pi * idx / p)).sum()
        if abs(z) > best[0]:
            best = (abs(z), p, (np.angle(z) / (2 * np.pi) * p) % p)
    return best[1], best[2]


if forced:
    (px, py), ox, oy = forced, 0.0, 0.0
else:
    px, ox = fit_grid(np.abs(np.diff(a, axis=1)).sum(2).sum(0))
    py, oy = fit_grid(np.abs(np.diff(a, axis=0)).sum(2).sum(1))
n, m = int((W - ox) // px), int((H - oy) // py)

# Flatness of every 3x3 patch: low inside a pixel, high across its edges.
pad = np.pad(a, ((1, 1), (1, 1), (0, 0)), mode='edge')
var3 = np.stack([pad[dy:dy + H, dx:dx + W] for dy in range(3) for dx in range(3)]).var(0).sum(2)
pixels = np.zeros((m, n, 3), np.uint8)
for j in range(m):
    cy = oy + (j + 0.5) * py
    for i in range(n):
        cx = ox + (i + 0.5) * px
        y0, y1 = int(max(1, cy - px * 0.3)), int(min(H - 2, cy + px * 0.3)) + 1
        x0, x1 = int(max(1, cx - px * 0.3)), int(min(W - 2, cx + px * 0.3)) + 1
        if forced:  # not the painting's own grid: take the area this pixel covers
            ya, yb = int(round(oy + j * py)), int(round(oy + (j + 1) * py))
            xa, xb = int(round(ox + i * px)), int(round(ox + (i + 1) * px))
            pixels[j, i] = np.median(a[ya:yb, xa:xb].reshape(-1, 3), axis=0)
            continue
        k = np.unravel_index(var3[y0:y1, x0:x1].argmin(), (y1 - y0, x1 - x0))
        yy, xx = y0 + k[0], x0 + k[1]
        pixels[j, i] = np.median(a[yy - 1:yy + 2, xx - 1:xx + 2].reshape(-1, 3), axis=0)

q = Image.fromarray(pixels).quantize(colors=n_colours, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
idx = np.asarray(q)
pal = np.array(q.getpalette()[:3 * n_colours]).reshape(-1, 3)
used = sorted(set(idx.flatten().tolist()))
remap = {old: new for new, old in enumerate(used)}
palette = ['#%02x%02x%02x' % tuple(pal[i]) for i in used]
rows = [''.join('%02x' % remap[v] for v in row) for row in idx]

with open(out_js, 'w') as f:
    f.write(f'// {n} x {m} pixels traced from {src.split("/")[-1]} by tools/image_to_pixels.py:\n')
    f.write(f'// {px:.3f} x {py:.3f} image px per pixel. Each row is two hex digits per\n')
    f.write('// pixel, an index into the palette.\n')
    f.write(f'const {name} = {{\n  width: {n},\n  height: {m},\n  palette: [\n')
    for k in range(0, len(palette), 8):
        f.write('    ' + ', '.join(f'"{c}"' for c in palette[k:k + 8]) + ',\n')
    f.write('  ],\n  rows: [\n')
    for r in rows:
        f.write(f'    "{r}",\n')
    f.write('  ],\n};\n')
print(f'grid {px:.3f} x {py:.3f} px, offset {ox:.2f}, {oy:.2f} -> {n} x {m} pixels, {len(palette)} colours')
