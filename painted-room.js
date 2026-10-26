// Painted rooms: rooms built in code from a layout, in a chunky block style.
// A room's whole still scene (cobbled floor, ruined walls with an archway,
// the tower's sides falling away into the dark, broken edges and holes) is
// painted once at world-pixel resolution: each pixel looks into a set of
// stone boxes and paints the nearest surface it meets. Torch flames and
// their light are drawn on top every frame.
//
// Distances are in floor tiles. A tile is 48 x 24 world px (2:1 isometric);
// z (height) is 24 world px per tile. x runs down-right along the right-hand
// wall, y down-left along the left-hand wall, from the back corner (0, 0).

const WORLD_TILE_W = 48;
const WORLD_TILE_H = 24;
const PX = 1 / WORLD_TILE_H; // one world pixel, in tiles
const BLOCK = 1 / 4;   // walls, the floor's rim and broken ground are built from cubes this size
const COURSE = 1 / 4;  // height of one course of bricks
const WALL_T = 0.5;    // wall thickness
const DEPTH = 6;       // how far down the tower is painted before the dark takes it
const ZMAX = 4.4;      // tallest a wall can get
const CORNICE = 2 * BLOCK; // solid band of blocks round the top of the tower
const EDGE = 1;        // width of the band along the front edges built from separate cubes
const RIM = 2 * BLOCK; // the floor's outer edge: a row of cube tops rather than cobbles
const RECESS = 0.25;   // depth of the recesses between the tower's pillars
const PILLAR_W = 0.75, PILLAR_EVERY = 1.75;
const SETTS_PER_TILE = 2;
const TORCH_REACH = 4.5; // tiles the light reaches

const MORTAR = "#120e11";
const STONE = ["#221c21", "#2f272d", "#3d343a", "#4d4248", "#5f5358", "#76686b"]; // dark -> light
const MOSS = ["#262d1b", "#344026", "#465632"];
const WATER = ["#0e1424", "#16203a", "#223156", "#4d6aa0"]; // deep, mid, shallow rim, glint
// Palette indices: mortar, then the stone, moss and water ramps.
const P_STONE = 1, P_MOSS = P_STONE + STONE.length, P_WATER = P_MOSS + MOSS.length;
const PALETTE = [MORTAR, ...STONE, ...MOSS, ...WATER].map((c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)));

function hash(a, b, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // 0..1
}

// Smooth value noise, 0..1, with features about one unit apart.
function noise(x, y, k) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = hash(i, j, k) + (hash(i + 1, j, k) - hash(i, j, k)) * sx;
  const bottom = hash(i, j + 1, k) + (hash(i + 1, j + 1, k) - hash(i, j + 1, k)) * sx;
  return top + (bottom - top) * sy;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (px, py) => BAYER[(py & 3) * 4 + (px & 3)];
const stone = (shade) => P_STONE + Math.max(0, Math.min(STONE.length - 1, shade));

// ---------- Layout -> stone boxes ----------
function profile(points, u) {
  for (let i = 1; i < points.length; i++) {
    const [u0, z0] = points[i - 1], [u1, z1] = points[i];
    if (u <= u1) return z0 + (z1 - z0) * Math.max(0, (u - u0) / (u1 - u0));
  }
  return points[points.length - 1][1];
}

// A ruined wall column's height: the layout's profile, made jagged and
// rounded to whole blocks.
function wallHeight(points, u, k, side) {
  const jag = (noise(u * 1.5, side * 3, 21) - 0.5) * 0.6 + (hash(k, side, 22) - 0.5) * 0.5;
  return Math.max(2 * BLOCK, Math.round((profile(points, u) + jag) / BLOCK) * BLOCK);
}

// Height of a cube in the band along the front edges: most sit flush with
// the floor, some outer ones are chipped down, missing, or stand proud.
function rimTop(i, j, outer) {
  const r = hash(i, j, 70);
  if (outer) return r < 0.1 ? null : r < 0.3 ? -BLOCK : r > 0.93 ? BLOCK : 0;
  return r < 0.06 ? -BLOCK : 0;
}

// Removes the layout's holes from a set of boxes, all the way down.
function cutHoles(boxes, holes) {
  for (const h of holes) {
    boxes = boxes.flatMap((b) => {
      if (b.x1 <= h.x0 || b.x0 >= h.x1 || b.y1 <= h.y0 || b.y0 >= h.y1) return [b];
      const out = [];
      if (b.y0 < h.y0) out.push({ ...b, y1: h.y0 });
      if (b.y1 > h.y1) out.push({ ...b, y0: h.y1 });
      const y0 = Math.max(b.y0, h.y0), y1 = Math.min(b.y1, h.y1);
      if (b.x0 < h.x0) out.push({ ...b, x1: h.x0, y0, y1 });
      if (b.x1 > h.x1) out.push({ ...b, x0: h.x1, y0, y1 });
      return out;
    });
  }
  return boxes;
}

function buildBoxes(L) {
  const T = WALL_T, W = L.w, H = L.h, boxes = [];
  // A loose cube on top of some wall columns, so the broken tops are chunky.
  const cap = (k, side, z1, place) => {
    if (hash(k, side, 26) > 0.3) return;
    const shift = (hash(k, side, 27) - 0.5) * 0.2;
    boxes.push({ kind: "wall", ...place(-T + 0.06 + shift, -0.06 + shift), z0: z1, z1: z1 + BLOCK });
  };
  // Back-left wall: x in [-T, 0], in columns along y (it also covers the back corner).
  for (let k = 0, y0 = -T; y0 < H - 1e-9; k++, y0 += BLOCK) {
    const y1 = Math.min(H, y0 + BLOCK);
    const z1 = wallHeight(L.leftWall, Math.max(0, (y0 + y1) / 2), k, 1);
    boxes.push({ kind: "wall", x0: -T, x1: 0, y0, y1, z0: 0, z1 });
    cap(k, 1, z1, (a, b) => ({ x0: a, x1: b, y0, y1 }));
  }
  // Back-right wall: y in [-T, 0], in columns along x, with the archway cut through it.
  for (let k = 0, x0 = 0; x0 < W - 1e-9; k++, x0 += BLOCK) {
    const x1 = Math.min(W, x0 + BLOCK), u = (x0 + x1) / 2;
    let z1 = wallHeight(L.rightWall, u, k, 2), z0 = 0;
    const t = L.arch ? (u - L.arch.c) / L.arch.r : 2;
    if (Math.abs(t) < 1) {
      z0 = L.arch.spring + L.arch.rise * Math.sqrt(1 - t * t);
      z1 = Math.max(z1, Math.ceil((z0 + 0.5) / BLOCK) * BLOCK); // keep solid blocks over the arch
    }
    boxes.push({ kind: "wall", x0, x1, y0: -T, y1: 0, z0, z1 });
    cap(k, 2, z1, (a, b) => ({ x0, x1, y0: a, y1: b }));
  }
  // The top of the tower: a solid band, with separate cubes along the front
  // edges so they can be chipped.
  boxes.push({ kind: "tower", x0: -T, x1: W - EDGE, y0: -T, y1: H - EDGE, z0: -CORNICE, z1: 0 });
  for (let j = 0, y0 = -T; y0 < H - 1e-9; j++, y0 += BLOCK) {
    for (let i = 0, x0 = -T; x0 < W - 1e-9; i++, x0 += BLOCK) {
      if (x0 < W - EDGE - 1e-9 && y0 < H - EDGE - 1e-9) continue;
      const top = rimTop(i, j, x0 >= W - BLOCK - 1e-9 || y0 >= H - BLOCK - 1e-9);
      if (top !== null) boxes.push({ kind: "tower", x0, x1: x0 + BLOCK, y0, y1: y0 + BLOCK, z0: -CORNICE, z1: top });
    }
  }
  // Below it: a core set back from both front sides, with pillars standing
  // out in front of it all the way down; one always stands on the front corner.
  boxes.push({ kind: "core", x0: -T, x1: W - RECESS, y0: -T, y1: H - RECESS, z0: -DEPTH, z1: -CORNICE });
  for (let u = 0.4; u < W - 0.6; u += PILLAR_EVERY) {
    boxes.push({ kind: "pillar", x0: u, x1: u + PILLAR_W, y0: H - RECESS, y1: H, z0: -DEPTH, z1: -CORNICE });
  }
  for (let u = 0.4; u < H - 0.6; u += PILLAR_EVERY) {
    boxes.push({ kind: "pillar", x0: W - RECESS, x1: W, y0: u, y1: u + PILLAR_W, z0: -DEPTH, z1: -CORNICE });
  }
  boxes.push({ kind: "pillar", x0: W - PILLAR_W, x1: W, y0: H - RECESS, y1: H, z0: -DEPTH, z1: -CORNICE });
  boxes.push({ kind: "pillar", x0: W - RECESS, x1: W, y0: H - PILLAR_W, y1: H, z0: -DEPTH, z1: -CORNICE });
  return cutHoles(boxes, L.holes);
}

// ---------- Surfaces ----------
// Bricks on a vertical face. u runs along the face, v up it (tiles); base is
// the face's light. Each brick is bevelled: lit along its top and left
// edges, shaded along its bottom, so the masonry reads as stacked blocks.
function brick(u, v, base, rough, px, py, side) {
  const course = Math.floor(v / COURSE);
  const fv = (v / COURSE - course) * COURSE; // tiles up from the course's bottom
  const len = 0.25 + hash(course, side, 31) * 0.12;
  const w = (u + hash(course, side, 32) * len) / len;
  const bi = Math.floor(w), fu = (w - bi) * len; // tiles along from the brick's left
  const id = hash(bi, course * 7 + side, 33);
  if (fv < PX || fu < PX) { // mortar, a little mossy low on the walls
    return v > 0 && v < 1.5 && noise(u * 1.3, v * 1.3 + side * 10, 37) > 0.66 ? P_MOSS : 0;
  }
  if (id < 0.03 + rough * 0.08) return fv > COURSE - 2 * PX ? P_STONE : 0; // a missing brick
  let shade = base + Math.floor(hash(bi, course * 7 + side, 34) * 3) - 1;
  if (hash(px, py, 35) < 0.07) shade += hash(px, py, 36) < 0.5 ? -1 : 1;
  if (fv > COURSE - 2 * PX || fu < 2 * PX) shade += 1;
  else if (fv < 2 * PX) shade -= 1;
  return stone(shade);
}

// The top of a cube: mortar between cubes, its back-left edge catching the
// light, its front edges in shade.
function cubeTop(x, y, base, px, py) {
  const fx = (x / BLOCK - Math.floor(x / BLOCK)) * BLOCK, fy = (y / BLOCK - Math.floor(y / BLOCK)) * BLOCK;
  if (fx < 0.03 || fy < 0.03) return 0;
  let shade = base + Math.floor(hash(Math.floor(x / BLOCK), Math.floor(y / BLOCK), 71) * 2);
  if (fx < 0.075) shade += 2;
  else if (fy < 0.075) shade += 1;
  else if (fx > BLOCK - 0.04 || fy > BLOCK - 0.04) shade -= 1;
  if (hash(px, py, 72) < 0.06) shade -= 1;
  return stone(shade);
}

// Floor cobbles: square setts in a regular grid along the floor, each a
// little different in size, roundness and tone.
function sett(x, y) {
  const n = SETTS_PER_TILE;
  const i = Math.floor(x * n), j = Math.floor(y * n);
  const jx = (hash(i, j, 61) - 0.5) * 0.08, jy = (hash(i, j, 62) - 0.5) * 0.08;
  const size = 0.84 + hash(i, j, 63) * 0.1;
  const p = 3 + hash(i, j, 65) * 2;
  const lx = (2 * (x * n - i - 0.5 - jx)) / size, ly = (2 * (y * n - j - 0.5 - jy)) / size;
  const r = Math.pow(Math.abs(lx) ** p + Math.abs(ly) ** p, 1 / p) + (noise(x * 10, y * 10, 66) - 0.5) * 0.1;
  return { i, j, lx, ly, r }; // r: 0 in the middle of a stone, 1 at its edge
}

function floorColour(L, x, y, px, py) {
  const c = sett(x, y);
  const mortar = c.r > 0.92;

  // Wetness: above 0 inside a puddle; a little below 0 near one.
  let wet = -Infinity;
  for (const p of L.puddles) wet = Math.max(wet, 1 - Math.hypot(x - p.x, y - p.y) / p.r);
  wet += (noise(x * 2.5, y * 2.5, 7) - 0.5) * 0.5; // ragged, uneven shores
  if (wet > 0.12) {
    const deep = wet > 0.42;
    // In the shallows the tops of the stones break the surface, wet and dark.
    if (!deep && !mortar && c.r < 0.6 && wet < 0.3) return stone(1);
    if (deep && hash(Math.floor(px / 2), py, 8) < 0.02) return P_WATER + 3; // glints
    if (wet < 0.18) return P_WATER + 2; // shallow rim
    return P_WATER + (deep && bayer(px, py) < (wet - 0.42) * 3 ? 0 : 1); // dithered deeper in
  }
  // Water seeps out along the joints, further in some directions than others.
  if (mortar && wet > -0.25 - noise(x * 4, y * 4, 9) * 0.3) return P_WATER + 1;
  // Sparse moss, only in the joints inside a few patches.
  if (mortar && noise(x * 1.4, y * 1.4, 11) > 0.7 && hash(px, py, 12) < 0.7) return P_MOSS + (hash(px, py, 13) < 0.4 ? 1 : 0);
  if (mortar) return 0;

  const tone = hash(c.i, c.j, 3);
  let shade = tone < 0.1 ? 1 : tone > 0.93 ? 4 : 2 + Math.floor((tone - 0.1) / 0.83 * 2); // 1..4
  if (hash(px, py, 4) < 0.06) shade += hash(px, py, 5) < 0.5 ? -1 : 1;
  // Bevel: each stone's top-left rim catches the light, its bottom-right is in shade.
  if (c.r > 0.7) {
    const toLight = -((c.lx - c.ly) * 0.45 + (c.lx + c.ly) * 0.9);
    if (toLight > 0.05) shade += 2;
    else if (toLight < -0.05) shade -= 1;
  }
  if (wet > -0.12) shade -= 1; // damp near a puddle
  if (Math.min(x, y) < 0.3) shade -= 1; // shade where the floor meets the walls
  return stone(shade);
}

// Palette index (or -1 for nothing) for the surface a pixel sees.
function shadeHit(L, box, face, x, y, z, px, py) {
  if (face === "top") {
    if (box.kind === "wall") return cubeTop(x, y, 2, px, py);
    if (Math.abs(z) < 1e-6 && x >= 0 && y >= 0 && x < L.w - RIM && y < L.h - RIM) return floorColour(L, x, y, px, py);
    if (z > -1e-6) return cubeTop(x, y, 2, px, py); // the rim, cubes standing proud, ground under the arch
    return cubeTop(x, y, 1 - Math.floor(-z / 0.5), px, py); // broken-down blocks, darker the lower
  }
  // Vertical faces. "east" faces +x, "south" faces +y; south faces the light.
  const u = face === "east" ? y : x;
  const lit = face === "south" ? 1 : 0;
  const side = face === "east" ? 1 : 2;
  if (box.kind === "wall") return brick(u, z, 2 + lit, 0, px, py, side);
  const outside = (face === "east" && x >= L.w - 1e-6) || (face === "south" && y >= L.h - 1e-6);
  let colour;
  if (box.kind === "pillar" || outside) colour = brick(u, z, 1 + lit, 0.1, px, py, side + 2);
  else if (box.kind === "core") colour = brick(u, z, lit - 1, 0.1, px, py, side + 2); // back in a recess
  else colour = brick(u, z, lit, 0.5, px, py, side + 4); // broken-open masonry inside the tower
  // The tower's sides darken and fall away into the dark.
  const d = -z;
  if (colour >= P_STONE && colour < P_MOSS) colour = Math.max(P_STONE, colour - Math.floor(Math.max(0, d - 0.5) / 1.3));
  if ((d - 1) / (DEPTH * 0.8 - 1) > bayer(px, py)) return -1;
  return colour;
}

const NORMALS = { top: [0, 0, 1], east: [1, 0, 0], south: [0, 1, 0] };

// Where a torch meets its wall, and where its flame (the light) is.
function torchWorld(t) {
  const wall = t.wall === "left" ? [0, t.u, t.z] : [t.u, 0, t.z];
  const out = t.wall === "left" ? [0.2, 0, 0.45] : [0, 0.2, 0.45];
  return { wall, flame: wall.map((v, i) => v + out[i]) };
}

// ---------- Painting ----------
function paintRoom(L) {
  const T = WALL_T, W = L.w, H = L.h;
  const OX = Math.ceil((H + T) * WORLD_TILE_W / 2) + 2;
  const OY = Math.ceil((ZMAX + 2 * T) * WORLD_TILE_H) + 2;
  const CW = Math.ceil((W + H + 2 * T) * WORLD_TILE_W / 2) + 4;
  const CH = OY + Math.ceil((W + H) * WORLD_TILE_H / 2 + DEPTH * WORLD_TILE_H) + 4;
  const boxes = buildBoxes(L);

  // Which boxes can show in each column of pixels.
  const columns = Array.from({ length: CW }, () => []);
  for (const b of boxes) {
    const from = Math.max(0, Math.floor(OX + (b.x0 - b.y1) * WORLD_TILE_W / 2) - 1);
    const to = Math.min(CW - 1, Math.ceil(OX + (b.x1 - b.y0) * WORLD_TILE_W / 2) + 1);
    for (let px = from; px <= to; px++) columns[px].push(b);
  }

  const art = document.createElement("canvas");
  art.width = CW;
  art.height = CH;
  const g = art.getContext("2d");
  const img = g.createImageData(CW, CH);
  const torches = L.torches.map((t) => ({ ...t, ...torchWorld(t), light: new Float32Array(CW * CH), box: [CW, CH, 0, 0] }));

  for (let px = 0; px < CW; px++) {
    const a = (px + 0.5 - OX) / (WORLD_TILE_W / 2); // x - y along this column
    for (let py = 0; py < CH; py++) {
      const b = (py + 0.5 - OY) / (WORLD_TILE_H / 2); // x + y - 2z along this pixel's line of sight
      // Walk along the line of sight with s = x + y (bigger is nearer) and keep
      // the nearest box surface it passes through.
      let best = null, bestS = -Infinity, bestFace = "";
      for (const bx of columns[px]) {
        const hx = 2 * bx.x1 - a, hy = 2 * bx.y1 + a, hz = 2 * bx.z1 + b;
        const lo = Math.max(2 * bx.x0 - a, 2 * bx.y0 + a, 2 * bx.z0 + b);
        const hi = Math.min(hx, hy, hz);
        if (lo <= hi && hi > bestS) {
          bestS = hi;
          best = bx;
          bestFace = hi === hz ? "top" : hi === hx ? "east" : "south";
        }
      }
      if (!best) continue;
      const x = (bestS + a) / 2, y = (bestS - a) / 2, z = (bestS - b) / 2;
      const colour = shadeHit(L, best, bestFace, x, y, z, px, py);
      if (colour < 0) continue;
      const o = (py * CW + px) * 4;
      [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]] = [...PALETTE[colour], 255];

      // How much each torch lights this spot: falls off with distance, and
      // only surfaces facing the flame are lit.
      const n = NORMALS[bestFace];
      for (const t of torches) {
        const lx = t.flame[0] - x, ly = t.flame[1] - y, lz = t.flame[2] - z;
        const d = Math.hypot(lx, ly, lz);
        if (d >= TORCH_REACH) continue;
        const facing = (n[0] * lx + n[1] * ly + n[2] * lz) / d;
        if (facing <= 0) continue;
        const level = Math.pow(1 - d / TORCH_REACH, 1.5) * (0.35 + 0.65 * facing);
        const band = Math.floor(level * 8) / 8; // flat bands, so the light stays pixel art
        if (band <= 0) continue;
        t.light[py * CW + px] = band;
        t.box = [Math.min(t.box[0], px), Math.min(t.box[1], py), Math.max(t.box[2], px), Math.max(t.box[3], py)];
      }
    }
  }
  g.putImageData(img, 0, 0);

  // Each torch's light becomes its own warm layer, cropped to where it reaches.
  const lights = torches.map((t) => {
    const [x0, y0, x1, y1] = t.box;
    const lw = Math.max(1, x1 - x0 + 1), lh = Math.max(1, y1 - y0 + 1);
    const c = document.createElement("canvas");
    c.width = lw;
    c.height = lh;
    const lg = c.getContext("2d");
    const li = lg.createImageData(lw, lh);
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const v = t.light[(y + y0) * CW + x + x0];
        if (!v) continue;
        const o = (y * lw + x) * 4;
        [li.data[o], li.data[o + 1], li.data[o + 2], li.data[o + 3]] = [255, 138, 52, Math.round(Math.min(1, v * 0.85) * 255)];
      }
    }
    lg.putImageData(li, 0, 0);
    return { canvas: c, x0, y0 };
  });
  return { canvas: art, OX, OY, lights, torches: L.torches };
}

// ---------- Torches ----------
// A wall bracket and torch, drawn in world pixels for a torch on the left
// wall (sticking out to the right); torches on the right wall use it
// mirrored. The plate (column 0, row 6) sits on the wall; the flame stands in
// the cup (centred on column 4.5).
const BRACKET = [
  "..cccccc..",
  "..ckkkkc..",
  "...cPPc...",
  "....Ww....",
  "....Ww....",
  "p..iWwi...",
  "pi.iWwi...",
  "p.iiWw....",
  "p...Ww....",
  ".....w....",
];
const BRACKET_ANCHOR = 6, CUP_X = 4.5;
const BRACKET_COLOURS = { p: "#1c1b1f", P: "#2f2d33", i: "#2f2d33", k: "#1c1b1f", c: "#4a4650", w: "#3b2716", W: "#5a3b20" };
const FLAME_W = 9, FLAME_H = 18, FLAME_FRAMES = 8;
const FLAME_COLOURS = ["#7a1e10", "#c2401a", "#ec7a1c", "#f7c23a", "#fff1a8"]; // outer to core

function spriteCanvas(rows, colours) {
  const c = document.createElement("canvas");
  c.width = rows[0].length;
  c.height = rows.length;
  const g = c.getContext("2d");
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!colours[ch]) return;
    g.fillStyle = colours[ch];
    g.fillRect(x, y, 1, 1);
  }));
  return c;
}

// Looping flame animation: a teardrop shape eaten into by noise that rises
// through it; the noise repeats every 4 units, so frame 8 is frame 0 again.
function flameFrames() {
  const loopNoise = (x, y, k) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const h = (a, b) => hash(a, ((b % 4) + 4) % 4, k);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const top = h(i, j) + (h(i + 1, j) - h(i, j)) * sx;
    const bottom = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
    return top + (bottom - top) * sy;
  };
  const frames = [];
  for (let f = 0; f < FLAME_FRAMES; f++) {
    const rows = [];
    for (let y = 0; y < FLAME_H; y++) {
      const up = (FLAME_H - 1 - y) / (FLAME_H - 1); // 0 at the base, 1 at the tip
      const sway = Math.sin(up * 2.5 + (f / FLAME_FRAMES) * Math.PI * 2) * 0.7 * up;
      // Teardrop: rounded at the base, widest a third of the way up, to a point.
      const halfW = 4.3 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.16 + up * 0.92)))) + 0.3;
      let row = "";
      for (let x = 0; x < FLAME_W; x++) {
        const across = Math.abs(x - (FLAME_W - 1) / 2 - sway) / halfW;
        const n = loopNoise(x * 0.8, up * 2 + (f / FLAME_FRAMES) * 4, 50);
        const heat = 1 - across - up * 0.45 + (n - 0.5) * (0.5 + up * 0.6); // licks more near the tip
        row += heat > 0.72 ? "4" : heat > 0.52 ? "3" : heat > 0.32 ? "2" : heat > 0.16 ? "1" : heat > 0.04 ? "0" : ".";
      }
      rows.push(row);
    }
    frames.push(spriteCanvas(rows, Object.fromEntries(FLAME_COLOURS.map((c, i) => [String(i), c]))));
  }
  return frames;
}

// A soft warm glow around each flame, in a few dithered rings.
const HALO_R = 20;
function haloSprite() {
  const size = HALO_R * 2 + 1;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - HALO_R, (y - HALO_R) * 0.85) / HALO_R;
      const band = Math.floor(Math.pow(Math.max(0, 1 - d), 1.4) * 4 + bayer(x, y)) / 4;
      if (band <= 0) continue;
      const o = (y * size + x) * 4;
      [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]] = [255, 150, 60, Math.round(band * 0.45 * 255)];
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const bracketSprite = spriteCanvas(BRACKET, BRACKET_COLOURS);
const flames = flameFrames();
const halo = haloSprite();

// 0.7..1: a quick unsteady flicker, different for each torch.
function flicker(time, i) {
  const t = time / 1000;
  return 0.85 + 0.09 * Math.sin(t * 9.1 + i * 2.1) + 0.06 * Math.sin(t * 23.7 + i * 4.3);
}

// Draws a painted room: its scene, then torchlight added on top, then the
// torches. at(x, y, z) gives the screen position of a floor point; scale is
// screen px per world px.
function drawPaintedRoom(scene, time, ctx, at, scale) {
  ctx.imageSmoothingEnabled = false;
  const origin = at(0, 0, 0);
  const place = (px, py) => [origin.x + (px - scene.OX) * scale, origin.y + (py - scene.OY) * scale];
  ctx.drawImage(scene.canvas, ...place(0, 0), scene.canvas.width * scale, scene.canvas.height * scale);

  ctx.globalCompositeOperation = "lighter";
  scene.lights.forEach(({ canvas: c, x0, y0 }, i) => {
    ctx.globalAlpha = flicker(time, i);
    ctx.drawImage(c, ...place(x0, y0), c.width * scale, c.height * scale);
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  scene.torches.forEach((t, i) => {
    const p = at(...torchWorld(t).wall);
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.scale((t.wall === "right" ? -1 : 1) * scale, scale);
    ctx.drawImage(bracketSprite, 0, -BRACKET_ANCHOR);
    const flameTop = 1 - BRACKET_ANCHOR - FLAME_H;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = flicker(time, i);
    ctx.drawImage(halo, CUP_X - HALO_R - 0.5, flameTop + FLAME_H * 0.55 - HALO_R - 0.5);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(flames[Math.floor(time / 90 + i * 3) % FLAME_FRAMES], CUP_X - FLAME_W / 2, flameTop);
    ctx.restore();
  });
}

// Can the skull's centre stand here? On the cobbles, a little in from the
// walls and the rim, and clear of the holes.
function paintedWalkable(L, x, y) {
  const m = 0.35;
  if (x < m || y < m || x > L.w - RIM - 0.2 || y > L.h - RIM - 0.2) return false;
  return !L.holes.some((h) => x > h.x0 - m && x < h.x1 + m && y > h.y0 - m && y < h.y1 + m);
}

// ---------- Layouts ----------
// The tower top: ruined walls along the two back edges, an archway in the
// right-hand wall, three torches, three puddles, and the front edges broken
// open.
const TOWER_TOP = {
  w: 10,
  h: 10,
  // Wall heights (tiles) along each back wall, from the back corner out.
  leftWall: [[0, 3.6], [1.0, 3.4], [1.8, 2.4], [2.6, 2.8], [3.2, 2.2], [4.4, 2.0], [5.0, 2.6], [6.0, 2.2],
    [7.0, 1.3], [8.0, 1.6], [8.8, 2.8], [9.6, 2.3], [10, 1.4]],
  rightWall: [[0, 3.8], [1.2, 3.6], [2.2, 3.0], [3.0, 2.2], [3.6, 1.5], [4.4, 2.2], [4.7, 3.0], [6.9, 3.0],
    [7.3, 2.5], [8.6, 2.4], [9.4, 1.9], [10, 1.2]],
  arch: { c: 5.8, r: 0.85, spring: 1.25, rise: 0.75 }, // in the right-hand wall
  torches: [
    { wall: "left", u: 3.7, z: 1.4 },
    { wall: "right", u: 1.7, z: 1.9 },
    { wall: "right", u: 7.9, z: 1.3 },
  ],
  puddles: [
    { x: 1.6, y: 5.6, r: 0.75 },
    { x: 6.0, y: 1.9, r: 0.7 },
    { x: 5.4, y: 6.4, r: 0.6 },
  ],
  // Pieces of the tower broken clean away, all the way down.
  holes: [
    { x0: 8.25, x1: 10, y0: 4.0, y1: 6.75 },
    { x0: 9.25, x1: 10, y0: 7.75, y1: 8.5 },
    { x0: 3.0, x1: 4.25, y0: 9.25, y1: 10 },
  ],
};
