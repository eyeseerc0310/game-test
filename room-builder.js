// Room builder: draws a room from scratch, as coded pixels, in the style of
// the first room. A layout says where the walls, archway, torches, puddles
// and broken edges are; the builder looks along each pixel's line of sight
// into a set of stone boxes and paints the surface it meets by the rules
// read off the first room: small cobbles with a light top-left and a dark
// bottom-right, cube tops with a bright edge, 5 px bevelled bricks, tower
// sides of block columns dithering into the dark. Every colour comes from
// the first room's own ramps; torchlight is painted in by moving colours
// from the stone ramp towards the warm and torchlight ramps.
//
// Distances are in floor tiles. A tile is 20 x 10 px (clean 2:1 isometric,
// as the first room's cube edges are) and one tile of height is 10 px.
// x runs down-right along the right-hand wall, y down-left along the
// left-hand wall, from the back corner (0, 0).

const BUILD_TILE_W = 20;
const BUILD_TILE_H = 10;
const BPX = 1 / BUILD_TILE_H; // one pixel, in tiles
const B_BLOCK = 0.5;   // walls, the floor's rim and broken ground are built from cubes this size
const B_COURSE = 0.5;  // height of one course of bricks (5 px)
const B_WALL_T = 0.5;  // wall thickness
const B_DEPTH = 9;     // how far down the tower is drawn before the dark takes it
const B_ZMAX = 5;      // tallest a wall can get
const B_BAND = 1;      // solid band of blocks round the top of the tower
const B_RIM = 0.5;     // the floor's outer edge: a row of cube tops rather than cobbles
const B_RECESS = 0.75; // depth of the slits between the tower's columns
const B_COLUMN_W = 1.25, B_COLUMN_EVERY = 1.5;
const B_SETTS = 2.5;   // cobbles per tile, along each side
const B_REACH = 6;     // tiles a torch's light reaches

// The first room's colour ramps, dark to light.
const OUTLINE = "#080808";
const STONE_RAMP = ["#16151a", "#1b1a22", "#272429", "#322d34", "#393438", "#4b4348", "#564b54", "#665657", "#766367", "#836b75"];
const WARM_RAMP = ["#46352a", "#564738", "#674937", "#755448", "#875537", "#975a36", "#a86237", "#c87746"];
const TORCH_RAMP = ["#874927", "#a75a26", "#b86427", "#c76927", "#d87426", "#ea8617", "#f28a16", "#fdd01b"];
const WATER_RAMP = ["#0d1424", "#19223a", "#1c2844", "#283656"];
const MOSS_RAMP = ["#1d211b", "#2d3026", "#3d4136"];
const IRON_RAMP = ["#16151a", "#272429", "#4b4348"];

function bHash(a, b, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // 0..1
}

function bNoise(x, y, k) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = bHash(i, j, k) + (bHash(i + 1, j, k) - bHash(i, j, k)) * sx;
  const bottom = bHash(i, j + 1, k) + (bHash(i + 1, j + 1, k) - bHash(i, j + 1, k)) * sx;
  return top + (bottom - top) * sy;
}

const B_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bBayer = (px, py) => B_BAYER[(py & 3) * 4 + (px & 3)];

// A stone colour: shade 0..9 on the stone ramp, warmed by torchlight 0..1.
// Light moves it onto the warm ramp and then the torchlight ramp, dithered
// between steps the way the first room's glow is.
function lit(shade, light, px, py) {
  shade = Math.max(0, Math.min(9, shade));
  if (shade === 0) return light > 0.55 ? WARM_RAMP[0] : OUTLINE;
  const level = light * 3.4 + (bBayer(px, py) - 0.5) * 0.6;
  if (level < 0.6) return STONE_RAMP[shade];
  const k = Math.round(((shade - 1) / 8) * 7);
  if (level < 1.6) return WARM_RAMP[k];
  return TORCH_RAMP[Math.min(7, k + (level > 2.4 ? 1 : 0))];
}

// ---------- Layout -> stone boxes ----------
function bProfile(points, u) {
  for (let i = 1; i < points.length; i++) {
    const [u0, z0] = points[i - 1], [u1, z1] = points[i];
    if (u <= u1) return z0 + (z1 - z0) * Math.max(0, (u - u0) / (u1 - u0));
  }
  return points[points.length - 1][1];
}

// A ruined wall column's height: the layout's profile, made jagged and
// rounded to whole blocks.
function bWallHeight(points, u, k, side) {
  const jag = (bNoise(u * 1.5, side * 3, 21) - 0.5) * 0.8 + (bHash(k, side, 22) - 0.5) * 0.6;
  return Math.max(2 * B_BLOCK, Math.round((bProfile(points, u) + jag) / B_BLOCK) * B_BLOCK);
}

// Removes the layout's holes from a set of boxes, all the way down.
function bCutHoles(boxes, holes) {
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

function bBuildBoxes(L) {
  const T = B_WALL_T, W = L.w, H = L.h, boxes = [];
  // A loose cube on top of some wall columns, so the broken tops are chunky.
  const cap = (k, side, z1, place) => {
    if (bHash(k, side, 26) > 0.35) return;
    boxes.push({ kind: "wall", ...place(), z0: z1, z1: z1 + B_BLOCK });
  };
  // Back-left wall: x in [-T, 0], in columns along y (it also covers the back corner).
  for (let k = 0, y0 = -T; y0 < H - 1e-9; k++, y0 += B_BLOCK) {
    const y1 = Math.min(H, y0 + B_BLOCK);
    let z1 = bWallHeight(L.leftWall, Math.max(0, (y0 + y1) / 2), k, 1), z0 = 0;
    const u = (y0 + y1) / 2, a = L.arches.find((g) => g.wall === "left" && Math.abs(u - g.c) < g.r);
    if (a) {
      const t = (u - a.c) / a.r;
      z0 = a.spring + a.rise * Math.sqrt(1 - t * t);
      z1 = Math.max(z1, Math.ceil((z0 + 0.6) / B_BLOCK) * B_BLOCK);
    }
    boxes.push({ kind: "wall", x0: -T, x1: 0, y0, y1, z0, z1 });
    cap(k, 1, z1, () => ({ x0: -T, x1: 0, y0, y1 }));
  }
  // Back-right wall: y in [-T, 0], in columns along x.
  for (let k = 0, x0 = 0; x0 < W - 1e-9; k++, x0 += B_BLOCK) {
    const x1 = Math.min(W, x0 + B_BLOCK), u = (x0 + x1) / 2;
    let z1 = bWallHeight(L.rightWall, u, k, 2), z0 = 0;
    const a = L.arches.find((g) => g.wall === "right" && Math.abs(u - g.c) < g.r);
    if (a) {
      const t = (u - a.c) / a.r;
      z0 = a.spring + a.rise * Math.sqrt(1 - t * t);
      z1 = Math.max(z1, Math.ceil((z0 + 0.6) / B_BLOCK) * B_BLOCK);
    }
    boxes.push({ kind: "wall", x0, x1, y0: -T, y1: 0, z0, z1 });
    cap(k, 2, z1, () => ({ x0, x1, y0: -T, y1: 0 }));
  }
  // The top of the tower: a solid band; the cubes along the front edges are
  // separate so some can be chipped down, missing, or standing proud.
  boxes.push({ kind: "tower", x0: -T, x1: W - B_BLOCK, y0: -T, y1: H - B_BLOCK, z0: -B_BAND, z1: 0 });
  for (let j = 0, y0 = -T; y0 < H - 1e-9; j++, y0 += B_BLOCK) {
    for (let i = 0, x0 = -T; x0 < W - 1e-9; i++, x0 += B_BLOCK) {
      if (x0 < W - B_BLOCK - 1e-9 && y0 < H - B_BLOCK - 1e-9) continue;
      const r = bHash(i, j, 70);
      const top = r < 0.08 ? null : r < 0.25 ? -B_BLOCK : r > 0.9 ? B_BLOCK : 0;
      if (top !== null) boxes.push({ kind: "tower", x0, x1: x0 + B_BLOCK, y0, y1: y0 + B_BLOCK, z0: -B_BAND, z1: top });
    }
  }
  // Below it: a core set back from both front sides, with columns standing
  // out in front of it all the way down; one always stands on the front corner.
  boxes.push({ kind: "core", x0: -T, x1: W - B_RECESS, y0: -T, y1: H - B_RECESS, z0: -B_DEPTH, z1: -B_BAND });
  for (let u = 0.25; u < W - 1; u += B_COLUMN_EVERY) {
    boxes.push({ kind: "column", x0: u, x1: u + B_COLUMN_W, y0: H - B_RECESS, y1: H, z0: -B_DEPTH, z1: -B_BAND });
  }
  for (let u = 0.25; u < H - 1; u += B_COLUMN_EVERY) {
    boxes.push({ kind: "column", x0: W - B_RECESS, x1: W, y0: u, y1: u + B_COLUMN_W, z0: -B_DEPTH, z1: -B_BAND });
  }
  boxes.push({ kind: "column", x0: W - B_COLUMN_W, x1: W, y0: H - B_RECESS, y1: H, z0: -B_DEPTH, z1: -B_BAND });
  boxes.push({ kind: "column", x0: W - B_RECESS, x1: W, y0: H - B_COLUMN_W, y1: H, z0: -B_DEPTH, z1: -B_BAND });
  return bCutHoles(boxes, L.holes);
}

// ---------- Surfaces ----------
// Bricks on a vertical face. u runs along the face, v up it; base is the
// face's shade. Each brick is bevelled: lit along its top and left edges,
// darker along its bottom, with a 1 px dark joint.
function bBrick(u, v, base, light, px, py, side, len0) {
  const course = Math.floor(v / B_COURSE);
  const fv = v - course * B_COURSE; // tiles up from the course's bottom
  const len = len0 + bHash(course, side, 31) * 0.3;
  const w = (u + bHash(course, side, 32) * len) / len;
  const bi = Math.floor(w), fu = (w - bi) * len; // tiles along from the brick's left
  if (fv < BPX || fu < BPX * 1.2) return lit(1, light * 0.6, px, py); // joint
  let shade = base + (bHash(bi, course * 7 + side, 34) < 0.25 ? -1 : bHash(bi, course * 7 + side, 35) < 0.15 ? 1 : 0);
  if (fv > B_COURSE - 1.5 * BPX) shade += 2; // the top edge catches the light
  else if (fu < 2.2 * BPX) shade += 1;
  else if (fv < 2 * BPX) shade -= 1;
  if (bHash(px, py, 36) < 0.05) shade += bHash(px, py, 37) < 0.5 ? -1 : 1;
  return lit(shade, light, px, py);
}

// The top of a cube: dark joints between cubes, a bright back-left edge,
// a lighter back-right edge, darker front edges.
function bCubeTop(x, y, base, light, px, py) {
  const fx = x / B_BLOCK - Math.floor(x / B_BLOCK), fy = y / B_BLOCK - Math.floor(y / B_BLOCK);
  if (fx < 0.08 || fy < 0.08) return lit(0, light, px, py);
  let shade = base + (bHash(Math.floor(x / B_BLOCK), Math.floor(y / B_BLOCK), 71) < 0.3 ? -1 : 0);
  if (fx < 0.22) shade += 3;
  else if (fy < 0.22) shade += 2;
  else if (fx > 0.88 || fy > 0.88) shade -= 1;
  return lit(shade, light, px, py);
}

// Floor cobbles: small rounded stones in rows along the floor, each a
// little different, with a light top-left, a dark bottom-right and dark joints.
function bCobble(L, x, y, light, px, py) {
  const n = B_SETTS;
  const j = Math.floor(y * n), off = 0; // stones in a straight grid, so they read as diamonds
  const i = Math.floor(x * n + off);
  const jx = (bHash(i, j, 61) - 0.5) * 0.15, jy = (bHash(i, j, 62) - 0.5) * 0.15;
  const lx = 2 * (x * n + off - i - 0.5 - jx), ly = 2 * (y * n - j - 0.5 - jy);
  const p = 2.5 + bHash(i, j, 65) * 2;
  const r = Math.pow(Math.abs(lx) ** p + Math.abs(ly) ** p, 1 / p) / (0.8 + bHash(i, j, 63) * 0.15);

  // Puddles: deep water in the middle, the tops of stones breaking the surface at the edge.
  let wet = -Infinity;
  for (const pd of L.puddles) wet = Math.max(wet, 1 - Math.hypot(x - pd.x, y - pd.y) / pd.r);
  wet += (bNoise(x * 3, y * 3, 7) - 0.5) * 0.4;
  if (wet > 0.15) {
    if (wet > 0.45) return bHash(Math.floor(px / 2), py, 8) < 0.03 ? WATER_RAMP[3] : WATER_RAMP[bBayer(px, py) < (wet - 0.45) * 3 ? 0 : 1];
    if (r < 0.75) return lit(2, light * 0.5, px, py);
    return WATER_RAMP[2];
  }
  if (r > 0.8) { // joint, sometimes mossy
    if (bNoise(x * 1.3, y * 1.3, 11) > 0.72 && bHash(px, py, 12) < 0.6) return MOSS_RAMP[bHash(px, py, 13) < 0.5 ? 1 : 0];
    return lit(0, light, px, py);
  }
  const tone = bHash(i, j, 3);
  let shade = tone < 0.2 ? 4 : tone > 0.85 ? 6 : 5;
  const toLight = -(lx * 0.4 + ly * 0.9); // towards the top-left of the screen
  if (r > 0.45 && toLight > 0.2) shade += 2;
  else if (r > 0.5 && toLight < -0.3) shade -= 2;
  if (wet > -0.1) shade -= 1; // damp near a puddle
  if (Math.min(x, y) < 0.35) shade -= 1; // shade where the floor meets the walls
  return lit(shade, light, px, py);
}

// Colour (or null for nothing) for the surface a pixel sees.
function bShade(L, box, face, x, y, z, light, px, py) {
  if (face === "top") {
    if (box.kind === "wall") return bCubeTop(x, y, 5, light, px, py);
    if (Math.abs(z) < 1e-6 && x >= 0 && y >= 0 && x < L.w - B_RIM && y < L.h - B_RIM) return bCobble(L, x, y, light, px, py);
    if (z > -1e-6) return bCubeTop(x, y, 5, light, px, py); // the rim, cubes standing proud
    return bCubeTop(x, y, 3 - Math.floor(-z / 0.5), light, px, py); // chipped-down blocks
  }
  // Vertical faces. "east" faces +x, "south" faces +y; south faces the light.
  const u = face === "east" ? y : x;
  const lift = face === "south" ? 1 : 0;
  const side = face === "east" ? 1 : 2;
  if (box.kind === "wall") return bBrick(u, z, 4 + lift, light, px, py, side, 0.7);
  let colour;
  if (box.kind === "core") colour = lit(z > -B_BAND - 1 ? 0 : 1, 0, px, py); // back in a gap between columns: deep shadow
  else colour = bBrick(u, z, 3 + lift, light * 0.5, px, py, side + 2, 0.5);
  // The tower's sides darken and fall away into the dark.
  const d = -z;
  if ((d - 4.5) / (B_DEPTH * 0.95 - 4.5) > bBayer(px, py)) return null;
  if (d > 3 && colour !== OUTLINE) {
    const k = STONE_RAMP.indexOf(colour);
    if (k > 1) colour = STONE_RAMP[Math.max(1, k - Math.floor((d - 2) / 1.6))];
  }
  return colour;
}

const B_NORMALS = { top: [0, 0, 1], east: [1, 0, 0], south: [0, 1, 0] };

// Where a torch's flame is: out from its wall and up a little.
function bTorchFlame(t) {
  return t.wall === "left" ? [0.25, t.u, t.z + 0.5] : [t.u, 0.25, t.z + 0.5];
}

// ---------- Building ----------
// Returns { width, height, canvas, origin } where origin is the pixel of
// floor point (0, 0).
function buildRoom(L) {
  const T = B_WALL_T, W = L.w, H = L.h;
  const OX = Math.ceil((H + T) * BUILD_TILE_W / 2) + 2;
  const OY = Math.ceil((B_ZMAX + 2 * T) * BUILD_TILE_H) + 2;
  const CW = Math.ceil((W + H + 2 * T) * BUILD_TILE_W / 2) + 4;
  const CH = OY + Math.ceil((W + H) * BUILD_TILE_H / 2 + B_DEPTH * BUILD_TILE_H) + 4;
  const boxes = bBuildBoxes(L);

  // Which boxes can show in each column of pixels.
  const columns = Array.from({ length: CW }, () => []);
  for (const b of boxes) {
    const from = Math.max(0, Math.floor(OX + (b.x0 - b.y1) * BUILD_TILE_W / 2) - 1);
    const to = Math.min(CW - 1, Math.ceil(OX + (b.x1 - b.y0) * BUILD_TILE_W / 2) + 1);
    for (let px = from; px <= to; px++) columns[px].push(b);
  }

  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  const g = canvas.getContext("2d");
  const img = g.createImageData(CW, CH);
  const rgbOf = {};
  const toRgb = (h) => (rgbOf[h] ||= [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
  const flames = L.torches.map(bTorchFlame);

  for (let px = 0; px < CW; px++) {
    const a = (px + 0.5 - OX) / (BUILD_TILE_W / 2); // x - y along this column
    for (let py = 0; py < CH; py++) {
      const b = (py + 0.5 - OY) / (BUILD_TILE_H / 2); // x + y - 2z along this pixel's line of sight
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
      // Torchlight here: falls off with distance; only faces turned to a flame.
      const n = B_NORMALS[bestFace];
      let light = 0;
      for (const f of flames) {
        const lx = f[0] - x, ly = f[1] - y, lz = f[2] - z;
        const d = Math.hypot(lx, ly, lz * 0.45);
        if (d >= B_REACH) continue;
        const facing = (n[0] * lx + n[1] * ly + n[2] * lz) / d;
        if (facing > 0) light = Math.max(light, Math.pow(1 - d / B_REACH, 1.1) * (0.45 + 0.55 * facing));
      }
      const colour = bShade(L, best, bestFace, x, y, z, light, px, py);
      if (!colour) continue;
      const o = (py * CW + px) * 4;
      [img.data[o], img.data[o + 1], img.data[o + 2]] = toRgb(colour);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { width: CW, height: CH, canvas, origin: { x: OX, y: OY } };
}

// A built room's layout, as a room the game can use: its pixels, its floor
// grid, where the skull may go, its doorways and its torches.
function builtRoom(L, extra) {
  const built = buildRoom(L);
  const at = (x, y, z = 0) => ({
    x: built.origin.x + (x - y) * BUILD_TILE_W / 2,
    y: built.origin.y + (x + y) * BUILD_TILE_H / 2 - z * BUILD_TILE_H,
  });
  return {
    built,
    alongX: [BUILD_TILE_W / 2, BUILD_TILE_H / 2],
    alongY: [-BUILD_TILE_W / 2, BUILD_TILE_H / 2],
    backCorner: { x: built.origin.x, y: built.origin.y },
    skullScale: 0.235, // the same pixel size as the first room
    walkable: (x, y) => {
      const m = 0.35;
      if (x < m || y < m || x > L.w - B_RIM - 0.25 || y > L.h - B_RIM - 0.25) return false;
      return !L.holes.some((h) => x > h.x0 - m && x < h.x1 + m && y > h.y0 - m && y < h.y1 + m);
    },
    torches: L.torches.map((t) => {
      const [fx, fy, fz] = bTorchFlame(t);
      const p = at(fx, fy, fz - 0.5);
      return { x: p.x, y: p.y };
    }),
    ...extra,
  };
}

// ---------- Layouts ----------
// A rebuild of the first room's layout, to check the builder against it.
const TOWER_TOP_LAYOUT = {
  w: 9,
  h: 9,
  // Wall heights (tiles) along each back wall, from the back corner out.
  leftWall: [[0, 4.4], [1, 4.0], [1.6, 3.0], [2.2, 3.6], [3.0, 2.8], [3.6, 3.4], [4.6, 2.6], [5.4, 3.0],
    [6.2, 2.2], [7.0, 2.6], [7.8, 3.4], [8.4, 2.6], [9, 1.6]],
  rightWall: [[0, 4.6], [1.2, 4.4], [2.0, 3.6], [2.6, 3.0], [3.2, 2.4], [3.8, 3.4], [6.4, 3.6], [6.8, 2.8],
    [7.6, 3.0], [8.4, 2.4], [9, 1.6]],
  arches: [{ wall: "right", c: 5.1, r: 0.9, spring: 1.4, rise: 0.8 }],
  torches: [
    { wall: "left", u: 3.4, z: 1.8 },
    { wall: "right", u: 1.6, z: 2.2 },
    { wall: "right", u: 7.3, z: 1.6 },
  ],
  puddles: [
    { x: 1.4, y: 5.0, r: 0.75 },
    { x: 5.6, y: 1.8, r: 0.7 },
    { x: 4.6, y: 5.8, r: 0.6 },
  ],
  // Pieces of the tower broken clean away, all the way down.
  holes: [
    { x0: 7.5, x1: 9, y0: 4.0, y1: 6.5 },
    { x0: 8.5, x1: 9, y0: 7.5, y1: 8.0 },
    { x0: 2.5, x1: 3.5, y0: 8.5, y1: 9 },
  ],
};
