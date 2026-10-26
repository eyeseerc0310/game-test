# Make several views of one character use exactly the same colours.
# 1. Shift each sprite's bone colours (mean and spread per channel) to match
#    the first sprite, the reference.
# 2. Pick one shared palette for all of them and snap every pixel to it.
# Eye-glow pixels are matched the same way but against the eye colours.
# Usage: python3 tools/match_colors.py <bone colours> <reference.png> <other.png>...
# Files are rewritten in place; run it on fresh cuts from tools/cut_sprite.py.
import sys
from PIL import Image
import numpy as np

n_colors = int(sys.argv[1])
paths = sys.argv[2:]
imgs = [np.asarray(Image.open(p).convert('RGBA')).astype(float) for p in paths]


def is_eye(px):
    return (px[:, 2] > px[:, 0] + 30) & (px[:, 2] > px[:, 1] + 30)


def stats(px):
    return px.mean(0), px.std(0) + 1e-6


def is_bone(px):
    return (px.mean(1) > 110) & ~is_eye(px)


# Bone is measured on its own: views with less black outline would otherwise
# look brighter and be darkened to compensate.
ref = imgs[0][imgs[0][..., 3] > 0][:, :3]
ref_stats = {False: stats(ref[is_bone(ref)]), True: stats(ref[is_eye(ref)])}

# 1. colour transfer, separately for bone/outline and for the eyes
matched = []
for im in imgs:
    px = im[im[..., 3] > 0][:, :3].copy()
    eye = is_eye(px)
    measure = {False: is_bone(px), True: eye}
    for group in (False, True):
        sel = eye == group
        if measure[group].sum() < 2:
            continue
        mean, std = stats(px[measure[group]])
        rmean, rstd = ref_stats[group]
        px[sel] = (px[sel] - mean) / std * rstd + rmean
    matched.append(np.clip(px, 0, 255))

# 2. one shared palette per group (k-means from evenly spread brightness levels),
#    so the few eye pixels keep their own purples
def palette(px, k):
    order = np.argsort(px.sum(1))
    centers = px[order[np.linspace(0, len(order) - 1, k).astype(int)]]
    for _ in range(30):
        label = ((px[:, None, :] - centers[None]) ** 2).sum(2).argmin(1)
        for j in range(k):
            if (label == j).any():
                centers[j] = px[label == j].mean(0)
    return np.unique(np.round(centers), axis=0)


def snap(px, centers):
    return centers[((px[:, None, :] - centers[None]) ** 2).sum(2).argmin(1)]


allpx = np.concatenate(matched)
alleye = is_eye(allpx)
pal = {False: palette(allpx[~alleye], n_colors), True: palette(allpx[alleye], 4)}

for path, im, px in zip(paths, imgs, matched):
    eye = is_eye(px)
    out_px = np.empty_like(px)
    for group in (False, True):
        if (eye == group).any():
            out_px[eye == group] = snap(px[eye == group], pal[group])
    out = np.zeros(im.shape, np.uint8)
    mask = im[..., 3] > 0
    out[mask, :3] = out_px
    out[mask, 3] = 255
    Image.fromarray(out, 'RGBA').save(path)
print(len(pal[False]), 'bone/outline colours +', len(pal[True]), 'eye colours, shared')
