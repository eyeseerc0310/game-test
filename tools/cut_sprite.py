# Cut a sprite out of an image and shrink it to its real pixel size.
# The background is either real transparency or a fake grey/white checkerboard.
# Usage: python3 tools/cut_sprite.py <source.png> <out.png> <preview.png> [height]
# Give a height (in art pixels) to match another view of the same character;
# views that are mostly cranium need a smaller height to cover the same area.
import sys
from PIL import Image
import numpy as np
from collections import deque
src, out, preview = sys.argv[1:4]
target_h = int(sys.argv[4]) if len(sys.argv) > 4 else None
ART_PX = 13  # source pixels per art pixel in the drawings so far
im = Image.open(src)
alpha = np.asarray(im.convert('RGBA'))[..., 3]
a = np.asarray(im.convert('RGB')).astype(int)
H, W, _ = a.shape
grey = ((a.max(2) - a.min(2)) < 14) & (a.min(2) > 140)   # checkerboard pixels
bg = np.zeros((H, W), bool)
q = deque()
for x in range(W):
    for y in (0, H - 1):
        if grey[y, x]: bg[y, x] = True; q.append((y, x))
for y in range(H):
    for x in (0, W - 1):
        if grey[y, x] and not bg[y, x]: bg[y, x] = True; q.append((y, x))
while q:
    y, x = q.popleft()
    for ny, nx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
        if 0 <= ny < H and 0 <= nx < W and grey[ny, nx] and not bg[ny, nx]:
            bg[ny, nx] = True; q.append((ny, nx))
if (alpha < 128).mean() > 0.05:  # real transparency: use it instead
    bg = alpha < 128
ys, xs = np.where(~bg)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
rgb = a[y0:y1, x0:x1]; fg = ~bg[y0:y1, x0:x1]
# Downscale so each art pixel becomes one real pixel.
px = (y1 - y0) / target_h if target_h else ART_PX
tw = round((x1 - x0) / px); th = round((y1 - y0) / px)
res = np.zeros((th, tw, 4), np.uint8)
for j in range(th):
    for i in range(tw):
        ya, yb = j * (y1-y0) // th, (j+1) * (y1-y0) // th
        xa, xb = i * (x1-x0) // tw, (i+1) * (x1-x0) // tw
        m = fg[ya:yb, xa:xb]
        if m.mean() < 0.5: continue
        # median keeps colours crisp instead of blending neighbouring art pixels
        c = rgb[ya:yb, xa:xb][m]
        res[j, i, :3] = np.median(c, axis=0); res[j, i, 3] = 255
img = Image.fromarray(res, 'RGBA'); img.save(out)
big = Image.new('RGBA', (tw*8, th*8), (40, 40, 50, 255)); big.alpha_composite(img.resize((tw*8, th*8), Image.NEAREST)); big.save(preview)
print((x1-x0, y1-y0), '->', img.size)
