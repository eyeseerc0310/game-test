# Turn a Pixelorama project (.pxo) into a horizontal sprite sheet.
# Each frame's first layer is shrunk by <scale> (drawings made at 4x are
# shrunk by 4), taking the most common colour in each block. Empty frames
# are skipped.
# Usage: python3 tools/pxo_to_sheet.py <project.pxo> <sheet.png> [scale]
import io
import json
import sys
import zipfile

import numpy as np
from PIL import Image

src, out = sys.argv[1:3]
k = int(sys.argv[3]) if len(sys.argv) > 3 else 1

z = zipfile.ZipFile(src)
meta = json.loads(z.read('data.json'))
w, h = meta['size_x'], meta['size_y']

frames = []
for i in range(1, len(meta['frames']) + 1):
    a = np.frombuffer(z.read(f'image_data/frames/{i}/layer_1'), np.uint8).reshape(h, w, 4)
    if not a[..., 3].any():
        continue
    b = a.reshape(h // k, k, w // k, k, 4).transpose(0, 2, 1, 3, 4).reshape(h // k, w // k, k * k, 4)
    small = np.zeros((h // k, w // k, 4), np.uint8)
    for y in range(h // k):
        for x in range(w // k):
            cols, counts = np.unique(b[y, x], axis=0, return_counts=True)
            small[y, x] = cols[counts.argmax()]
    frames.append(small)

sheet = np.concatenate(frames, axis=1)
Image.fromarray(sheet, 'RGBA').save(out)
print(len(frames), 'frames of', w // k, 'x', h // k, '->', out)
