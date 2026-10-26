// Dungeon crawler — isometric room with a floating skull that moves with WASD.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// The world is measured in tiles; the camera turns tiles into screen pixels.
const room = { w: 10, h: 10 };
// speed in tiles per second; facing is one of the keys of SPRITES below
const player = { x: 4.7, y: 4.7, size: 0.6, speed: 4, facing: "front" };

// Everything is measured in art pixels (one pixel of the drawings); `scale` is
// how many screen pixels one art pixel covers, shared by floor and sprites so
// they read as one drawing.
const TILE_W = 96; // width of one floor diamond in art pixels
const TILE_H = 48; // height of one floor diamond (2:1 isometric)

let scale = 1;
let originX = 0;
let originY = 0;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Fit the whole room on screen with some margin. Whole-number zoom when it
  // fits, so every art pixel is the same size; never bigger than 3x.
  // The fitted area runs from the tops of the walls down to a little of the
  // tower below the floor's front corner.
  const above = 3.6 * TILE_H, below = 1.2 * TILE_H;
  const roomPxW = (room.w + room.h + 0.8) * TILE_W / 2;
  const roomPxH = above + (room.w + room.h) * TILE_H / 2 + below;
  scale = Math.min(3, (canvas.width * 0.94) / roomPxW, (canvas.height * 0.94) / roomPxH);
  if (scale >= 1) scale = Math.floor(scale);

  // Centre that area on the screen, on a whole pixel.
  originX = Math.round(canvas.width / 2 - ((room.w - room.h) * TILE_W / 4) * scale);
  originY = Math.round((canvas.height - roomPxH * scale) / 2 + above * scale);
}
window.addEventListener("resize", resize);
resize();

// World (tile) coordinates -> screen pixels. z lifts a point straight up.
function toScreen(x, y, z = 0) {
  return {
    x: originX + (x - y) * (TILE_W / 2) * scale,
    y: originY + ((x + y) * (TILE_H / 2) - z * TILE_H) * scale,
  };
}

// Track which keys are held down.
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

const TURN_DELAY = 0.08; // seconds
let facingHeld = 0;

function update(dt) {
  // WASD follows the screen: W is up the screen, which is diagonal in the world.
  let dx = 0, dy = 0;
  if (keys.has("w")) { dx -= 1; dy -= 1; }
  if (keys.has("s")) { dx += 1; dy += 1; }
  if (keys.has("a")) { dx -= 1; dy += 1; }
  if (keys.has("d")) { dx += 1; dy -= 1; }

  // A / D show the profile, S the front, W the back, and the diagonals the
  // three-quarter views (front for S+A / S+D, back for W+A / W+D).
  const sideways = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
  const vertical = (keys.has("s") ? 1 : 0) - (keys.has("w") ? 1 : 0);
  const side = sideways > 0 ? "right" : "left";
  const end = vertical > 0 ? "front" : "back";
  let want = player.facing;
  if (sideways && vertical) want = end + "-" + side;
  else if (sideways) want = side;
  else if (vertical) want = end;

  // Only turn once a new facing has lasted a moment, so letting go of S+A
  // one key slightly before the other doesn't flick to the A-only pose.
  if (want === player.facing) facingHeld = 0;
  else if ((facingHeld += dt) >= TURN_DELAY) {
    player.facing = want;
    facingHeld = 0;
  }

  // Same speed in every direction.
  const len = Math.hypot(dx, dy);
  if (len) {
    player.x += (dx / len) * player.speed * dt;
    player.y += (dy / len) * player.speed * dt;
  }

  // Stay inside the room.
  player.x = Math.max(0, Math.min(room.w - player.size, player.x));
  player.y = Math.max(0, Math.min(room.h - player.size, player.y));

  // Hands ease toward the skull, each at its own pace (frame-rate independent).
  for (const h of hands) {
    const k = 1 - Math.exp(-h.follow * dt);
    h.x += (player.x - h.x) * k;
    h.y += (player.y - h.y) * k;
  }
}

// ---------- Tower summit ----------
// The floor is the top of a ruined tower. The whole still scene (cobbled
// floor, crumbling walls with an archway, the broken corner and the tower's
// sides falling away into the dark) is painted once, pixel by pixel, at art
// resolution: each pixel looks into a set of stone boxes and paints whatever
// surface it meets first. Torch flames and their light are drawn on top every
// frame.
//
// Cobbles are a jittered Voronoi pattern laid out on the floor itself (so the
// isometric view squashes them), joined by black mortar, lit from the top-left
// and limited to a small stone palette that shares the skull's outline black.
// Sparse moss grows in the joints, and a few puddles sit in the low spots with
// water running out along the joints around them.
const STONES_PER_TILE = 3;
const MORTAR = "#1a1915"; // the skull's outline black
const STONE = ["#2b2a2c", "#38363a", "#46434a", "#55515a", "#66616a", "#7a7480"]; // dark -> light
const MOSS = ["#27301d", "#36422a", "#4b5a35"]; // dark -> light
const WATER = ["#141b24", "#1d2733", "#2a3a4b", "#56708a"]; // deep, mid, shallow rim, glint
// Palette indices: mortar, then the stone, moss and water ramps.
const P_STONE = 1, P_MOSS = P_STONE + STONE.length, P_WATER = P_MOSS + MOSS.length;

// Puddles in tile units, kept clear of the skull's starting spot.
const PUDDLES = [
  { x: 2.3, y: 6.9, r: 0.95 },
  { x: 7.4, y: 2.5, r: 0.85 },
  { x: 6.6, y: 8.1, r: 0.55 },
];
const MOSS_PATCHES = 0.66; // noise level above which moss can grow; higher is sparser

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

// Jittered seed point of stone cell (i, j), in tile units.
function seed(i, j) {
  return {
    x: (i + 0.2 + hash(i, j, 1) * 0.6) / STONES_PER_TILE,
    y: (j + 0.2 + hash(i, j, 2) * 0.6) / STONES_PER_TILE,
  };
}

// Palette index for a floor point: water, then moss, then bare stone.
function floorColour(x, y, px, py) {
  const c = cobble(x, y);
  const mortar = c.edge < 0.045;

  // Wetness: above 0 inside a puddle; a little below 0 near one.
  let wet = -Infinity;
  for (const p of PUDDLES) wet = Math.max(wet, 1 - Math.hypot(x - p.x, y - p.y) / p.r);
  wet += (noise(x * 2.5, y * 2.5, 7) - 0.5) * 0.5; // ragged, uneven shores
  if (wet > 0.12) {
    const deep = wet > 0.45;
    // In the shallows the tops of the stones break the surface, wet and dark.
    if (!deep && !mortar && c.edge > 0.085 && wet < 0.34) {
      return P_STONE + Math.max(0, stoneShade(c, x, y, px, py) - 2);
    }
    // Light catches the surface in short flat streaks out in the deep part.
    if (deep && hash(Math.floor(px / 3), py, 8) < 0.012) return P_WATER + 3;
    if (wet < 0.18) return P_WATER + 2; // shallow rim
    return P_WATER + (deep || mortar ? 0 : 1);
  }
  // Water seeps out along the joints, further in some directions than others.
  if (mortar && wet > -0.25 - noise(x * 4, y * 4, 9) * 0.35) return P_WATER + (hash(px, py, 10) < 0.15 ? 2 : 1);

  // Moss: only inside a few patches, in the joints and around stone rims.
  const m = noise(x * 1.4, y * 1.4, 11);
  if (m > MOSS_PATCHES && (mortar || c.edge < 0.1)) {
    const lush = (m - MOSS_PATCHES) / (1 - MOSS_PATCHES); // 0 at a patch's edge, 1 in its middle
    if (hash(px, py, 12) < 0.25 + lush * 0.6) return P_MOSS + (mortar ? 0 : hash(px, py, 13) < 0.5 ? 1 : 2);
  }

  if (mortar) return 0;
  // Stones near a puddle are damp and a shade darker.
  return P_STONE + Math.max(0, stoneShade(c, x, y, px, py) - (wet > -0.12 ? 1 : 0));
}

// Nearest stone and how close the point is to the joint around it.
function cobble(x, y) {
  const ci = Math.floor(x * STONES_PER_TILE), cj = Math.floor(y * STONES_PER_TILE);
  let d1 = Infinity, d2 = Infinity, near = null;
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      const s = seed(i, j);
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < d1) { d2 = d1; d1 = d; near = { i, j, s }; }
      else if (d < d2) d2 = d;
    }
  }
  return { edge: d2 - d1, near }; // edge is 0 on the line between two stones
}

// Shade index into STONE for a point on a stone.
function stoneShade({ edge, near }, x, y, px, py) {
  // Each stone gets its own tone; a few speckles break up flat areas.
  let shade = 2 + Math.floor(hash(near.i, near.j, 3) * 3) - 1; // 1..3
  if (hash(px, py, 4) < 0.07) shade += hash(px, py, 5) < 0.5 ? -1 : 1;

  // Bevel: the stone's top-left rim catches light, its bottom-right rim is in shade.
  if (edge < 0.11) {
    const sx = (x - near.s.x) - (y - near.s.y); // screen direction from the stone's middle
    const sy = (x - near.s.x) + (y - near.s.y);
    const toLight = -(sx * 0.45 + sy * 0.9);
    if (toLight > 0.02) shade += 2;
    else if (toLight < -0.02) shade -= 1;
  }
  return Math.max(0, Math.min(STONE.length - 1, shade));
}

// ---------- Ruins and tower ----------
const WALL_T = 0.4;   // wall thickness, tiles
const SLICE = 1 / 6;  // walls and broken ground are built from columns this wide
const COURSE = 1 / 6; // height of one course of bricks (8 art px)
const DEPTH = 5;      // how far down the tower is painted before the dark takes it
const ZMAX = 4.6;     // tallest a wall can get, tiles

// Ruined wall heights (tiles) along each back wall, from the back corner out.
const LEFT_WALL = [[0, 3.0], [0.8, 3.3], [1.6, 2.6], [2.1, 3.4], [3.5, 3.0], [4.4, 3.8], [5.0, 4.0],
  [5.5, 2.1], [6.8, 1.5], [7.3, 2.3], [7.7, 3.7], [8.6, 3.9], [9.4, 2.8], [10, 1.1]];
const RIGHT_WALL = [[0, 3.0], [1.0, 3.4], [2.8, 3.2], [3.0, 1.4], [3.9, 1.7], [4.3, 3.0], [7.0, 3.0],
  [7.3, 2.5], [8.6, 2.4], [9.3, 1.5], [10, 0.5]];
const ARCH = { c: 5.65, r: 1.05, spring: 1.45, rise: 0.95 }; // archway in the right wall
// Broken stretch of the front-right edge: middle (along y), half its length, deepest bite.
const BREAK = { y: 5.6, half: 2.0, bite: 1.7 };
const BAND = { x0: room.w - 2, y0: 3.5, y1: 7.7 }; // area the break is built in
// Torches: which wall, how far along it, how high.
const TORCHES = [
  { wall: "left", u: 4.2, z: 1.55 },
  { wall: "right", u: 2.2, z: 1.65 },
  { wall: "right", u: 8.2, z: 1.5 },
];
const TORCH_REACH = 3.4; // tiles the light reaches
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (px, py) => BAYER[(py & 3) * 4 + (px & 3)];

function profile(points, u) {
  for (let i = 1; i < points.length; i++) {
    const [u0, z0] = points[i - 1], [u1, z1] = points[i];
    if (u <= u1) return z0 + (z1 - z0) * Math.max(0, (u - u0) / (u1 - u0));
  }
  return points[points.length - 1][1];
}

// How far the break eats into the floor from the edge at y (tiles, 0 = intact).
function biteDepth(y) {
  const t = (y - BREAK.y) / BREAK.half;
  if (Math.abs(t) >= 1) return 0;
  return Math.max(0, BREAK.bite * Math.pow(1 - t * t, 0.7) + (noise(y * 2.2, 0.5, 23) - 0.5) * 0.5);
}

// Height of the ground at a point: 0 on the floor, lower in the broken corner.
function groundTop(x, y) {
  const bite = biteDepth(y);
  const e = room.w - x; // distance in from the edge
  if (x < BAND.x0 || y < BAND.y0 || y >= BAND.y1 || e >= bite) return 0;
  // It falls away in a few broad layers (1, 3 and 6 courses down), with
  // ragged but continuous edges between them.
  const close = 1 - e / bite + (noise(x * 2.5, y * 2.5, 24) - 0.5) * 0.3; // 0 at the rim, 1 at the edge
  return -(close < 0.35 ? 1 : close < 0.7 ? 3 : 6) * SLICE;
}

function wallHeight(points, u, k, side) {
  const jag = (noise(u * 1.7, side * 3, 21) - 0.5) * 0.5 + (hash(k, side, 22) - 0.5) * 0.35;
  return Math.max(0.35, Math.round((profile(points, u) + jag) / COURSE) * COURSE);
}

function buildBoxes() {
  const boxes = [];
  const T = WALL_T, W = room.w, H = room.h;
  // Back-left wall: x in [-T, 0], sliced along y (it also covers the back corner).
  for (let k = 0, y0 = -T; y0 < H; k++, y0 += SLICE) {
    const y1 = Math.min(H, y0 + SLICE);
    boxes.push({ kind: "wall", x0: -T, x1: 0, y0, y1, z0: 0, z1: wallHeight(LEFT_WALL, Math.max(0, (y0 + y1) / 2), k, 1) });
  }
  // Back-right wall: y in [-T, 0], sliced along x, with the archway cut through it.
  for (let k = 0, x0 = 0; x0 < W; k++, x0 += SLICE) {
    const x1 = Math.min(W, x0 + SLICE), u = (x0 + x1) / 2;
    let z1 = wallHeight(RIGHT_WALL, u, k, 2), z0 = 0;
    const t = (u - ARCH.c) / ARCH.r;
    if (Math.abs(t) < 1) {
      z0 = ARCH.spring + ARCH.rise * Math.sqrt(1 - t * t);
      z1 = Math.max(z1, Math.round((z0 + 0.6) / COURSE) * COURSE); // keep a solid course over the arch
    }
    boxes.push({ kind: "wall", x0, x1, y0: -T, y1: 0, z0, z1, arch: z0 > 0 });
  }
  // The tower: solid around the broken stretch, columns inside it.
  const bx0 = BAND.x0, by0 = BAND.y0, by1 = BAND.y1;
  boxes.push({ kind: "tower", x0: -T, x1: W, y0: -T, y1: by0, z0: -DEPTH, z1: 0 });
  boxes.push({ kind: "tower", x0: -T, x1: bx0, y0: by0, y1: by1, z0: -DEPTH, z1: 0 });
  boxes.push({ kind: "tower", x0: -T, x1: W, y0: by1, y1: H, z0: -DEPTH, z1: 0 });
  for (let y0 = by0; y0 < by1 - 1e-9; y0 += SLICE) {
    for (let x0 = bx0; x0 < W - 1e-9; x0 += SLICE) {
      const top = groundTop(x0 + SLICE / 2, y0 + SLICE / 2);
      boxes.push({ kind: "tower", x0, x1: x0 + SLICE, y0, y1: y0 + SLICE, z0: -DEPTH, z1: top });
    }
  }
  // Loose stones: fallen into the break and lying near its rim.
  for (let i = 0; i < 16; i++) {
    const y = BREAK.y + (hash(i, 1, 25) * 2 - 1) * BREAK.half * 0.9;
    const bite = biteDepth(y);
    if (bite < 0.2) continue;
    const x = room.w - bite * (0.2 + hash(i, 2, 25) * 1.1);
    const size = 0.07 + hash(i, 3, 25) * 0.13;
    const z0 = groundTop(x, y);
    boxes.push({ kind: "rubble", x0: x - size / 2, x1: x + size / 2, y0: y - size / 2, y1: y + size / 2, z0, z1: z0 + size * 0.8, id: i });
  }
  return boxes;
}

// Bricks on a vertical face. u runs along the face, v up it (tiles); base is
// the face's light (lit faces higher); rough makes broken masonry.
function brick(u, v, base, rough, px, py, side) {
  const course = Math.floor(v / COURSE);
  const fv = v / COURSE - course; // 0 at a course's bottom, 1 at its top
  const len = 0.28 + hash(course, side, 31) * 0.12;
  const w = (u + hash(course, side, 32) * len) / len;
  const bi = Math.floor(w), fu = w - bi;
  const id = hash(bi, course * 7 + side, 33);
  const m = noise(u * 1.3, v * 1.3 + side * 10, 37); // moss patches
  if (fv < 0.125 || fu * len < 0.021) return m > 0.64 && v < 2 ? P_MOSS : 0; // mortar
  if (id < 0.035 + rough * 0.1) return fv > 0.8 ? P_STONE : 0; // missing brick: a dark hole
  if (id > 0.6 && ((fu < 0.14 && fv > 0.75) || (fu > 0.88 && fv < 0.35))) return 0; // chipped corner
  if (id > 0.86 - rough * 0.2) { // a crack across the brick
    const k = ((id * 97) % 1) * 2 - 1;
    if (Math.abs(fu - 0.5 - k * (fv - 0.5) * 0.7) < 0.04) return 0;
  }
  let shade = base + Math.floor(hash(bi, course * 7 + side, 34) * 3) - 1;
  if (hash(px, py, 35) < 0.08) shade += hash(px, py, 36) < 0.5 ? -1 : 1;
  if (fv > 0.8) shade += 1; // each brick's top lip catches the light
  if (fv > 0.8 && m > 0.7) return P_MOSS + 1;
  return P_STONE + Math.max(0, Math.min(STONE.length - 1, shade));
}

// Palette index (or -1 for nothing) for the surface a pixel sees.
function shadeHit(box, face, x, y, z, px, py) {
  const W = room.w, H = room.h;
  if (box.kind === "rubble") return P_STONE + 1 + Math.floor(hash(box.id, face.length, 40) * 2) + (face === "top" ? 1 : 0);
  if (face === "top") {
    if (box.kind === "wall") { // weathered wall tops, mossy in places
      if (noise(x * 2, y * 2, 41) > 0.68 && hash(px, py, 42) < 0.6) return P_MOSS + 1 + (hash(px, py, 43) < 0.3 ? 1 : 0);
      return P_STONE + 2 + (hash(px, py, 44) < 0.25 ? 1 : 0) - (hash(px, py, 45) < 0.15 ? 1 : 0);
    }
    if (z < -1e-6) { // floor of the break: rubble and dust, darker the deeper it goes
      const c = cobble(x * 2.2, y * 2.2);
      if (c.edge < 0.05) return 0;
      const shade = 1 + Math.floor(hash(c.near.i, c.near.j, 46) * 2) - Math.floor(-z / 0.3);
      return P_STONE + Math.max(0, shade);
    }
    if (x < 0 || y < 0) return P_STONE + 2; // ground under the archway
    return floorPixel(x, y, px, py);
  }
  // Vertical faces. "east" faces +x, "south" faces +y; south faces the light.
  const u = face === "east" ? y : x;
  if (box.kind === "wall") return brick(u, z, face === "south" ? 2 : 1, 0, px, py, face === "east" ? 1 : 2);
  const outside = (face === "east" && x >= W - 1e-6) || (face === "south" && y >= H - 1e-6);
  let colour = brick(u, z, outside ? (face === "south" ? 2 : 1) : 0, outside ? 0.15 : 0.6, px, py, face === "east" ? 3 : 4);
  if (outside && z < 0) { // the tower's sides darken and fall away into the dark
    const d = -z;
    if (colour >= P_STONE && colour < P_MOSS) colour = Math.max(P_STONE, colour - Math.floor(d / 1.1));
    if ((d - 0.4) / (DEPTH * 0.8 - 0.4) > bayer(px, py)) return -1;
  }
  return colour;
}

// The floor, plus a little shade where it meets the walls and missing cobbles
// around the break.
function floorPixel(x, y, px, py) {
  const gap = (room.w - x) - biteDepth(y);
  if (gap >= 0 && gap < 0.4 && y > BAND.y0 && y < BAND.y1) {
    const c = cobble(x, y);
    if (hash(c.near.i, c.near.j, 47) < 0.6 * (1 - gap / 0.4)) return hash(px, py, 48) < 0.2 ? P_STONE : 0;
  }
  const colour = floorColour(x, y, px, py);
  const wallGap = Math.min(x, y);
  if (wallGap < 0.28 && colour >= P_STONE && colour < P_MOSS) return Math.max(P_STONE, colour - (wallGap < 0.12 ? 2 : 1));
  return colour;
}

const NORMALS = { top: [0, 0, 1], east: [1, 0, 0], south: [0, 1, 0] };

function torchWorld(t) {
  // Where the torch meets the wall, and where its flame (the light) is.
  const wall = t.wall === "left" ? [0, t.u, t.z] : [t.u, 0, t.z];
  const out = t.wall === "left" ? [0.22, 0, 0.42] : [0, 0.22, 0.42];
  return { wall, flame: wall.map((v, i) => v + out[i]) };
}

function paintScene() {
  const T = WALL_T, W = room.w, H = room.h;
  const OX = Math.ceil((H + T) * TILE_W / 2) + 2;
  const OY = Math.ceil((ZMAX + T) * TILE_H) + 2;
  const CW = Math.ceil((W + H + 2 * T) * TILE_W / 2) + 4;
  const CH = OY + Math.ceil((W + H) * TILE_H / 2 + DEPTH * TILE_H) + 4;
  const boxes = buildBoxes();

  // Which boxes can show in each column of pixels.
  const columns = Array.from({ length: CW }, () => []);
  for (const b of boxes) {
    const from = Math.max(0, Math.floor(OX + (b.x0 - b.y1) * TILE_W / 2) - 1);
    const to = Math.min(CW - 1, Math.ceil(OX + (b.x1 - b.y0) * TILE_W / 2) + 1);
    for (let px = from; px <= to; px++) columns[px].push(b);
  }

  const rgb = [MORTAR, ...STONE, ...MOSS, ...WATER].map((c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)));
  const art = document.createElement("canvas");
  art.width = CW;
  art.height = CH;
  const g = art.getContext("2d");
  const img = g.createImageData(CW, CH);
  const torches = TORCHES.map((t) => ({ ...t, ...torchWorld(t), light: new Float32Array(CW * CH), box: [CW, CH, 0, 0] }));

  for (let px = 0; px < CW; px++) {
    const a = (px + 0.5 - OX) / (TILE_W / 2); // x - y along this column
    for (let py = 0; py < CH; py++) {
      const b = (py + 0.5 - OY) / (TILE_H / 2); // x + y - 2z along this pixel's line of sight
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
      const colour = shadeHit(best, bestFace, x, y, z, px, py);
      if (colour < 0) continue;
      const o = (py * CW + px) * 4;
      [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]] = [...rgb[colour], 255];

      // How much each torch lights this spot: falls off with distance, and
      // only surfaces facing the flame are lit.
      const n = NORMALS[bestFace];
      for (const t of torches) {
        const lx = t.flame[0] - x, ly = t.flame[1] - y, lz = t.flame[2] - z;
        const d = Math.hypot(lx, ly, lz);
        if (d >= TORCH_REACH) continue;
        const facing = (n[0] * lx + n[1] * ly + n[2] * lz) / d;
        if (facing <= 0) continue;
        const level = Math.pow(1 - d / TORCH_REACH, 1.6) * (0.35 + 0.65 * facing);
        // A few hard-edged bands, dithered between, so the light stays pixel art.
        const band = Math.floor(level * 5 + bayer(px, py)) / 5;
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
    const lw = x1 - x0 + 1, lh = y1 - y0 + 1;
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
        [li.data[o], li.data[o + 1], li.data[o + 2], li.data[o + 3]] = [255, 150, 70, Math.round(v * 0.5 * 255)];
      }
    }
    lg.putImageData(li, 0, 0);
    return { canvas: c, x0, y0, torch: t };
  });
  return { canvas: art, OX, OY, lights };
}

// ---------- Torches ----------
// A wall bracket and torch, drawn for a torch on the left wall (sticking out to
// the right); torches on the right wall use it mirrored. The plate's middle
// (column 0, row 8) sits on the wall; the flame stands in the cup (column 8).
const BRACKET = [
  ".....cccccc.",
  ".....ckkkkc.",
  "......cWwc..",
  ".......Ww...",
  ".......Ww...",
  "pp....iWwi..",
  "pPi...iWwi..",
  "pPii..iWwi..",
  "pP.iii.Ww...",
  "pP.....Ww...",
  "pp.....Ww...",
  ".......Ww...",
  "........w...",
];
const BRACKET_ANCHOR = 8, CUP_X = 8;
const BRACKET_COLOURS = { p: "#1c1b1f", P: "#2f2d33", i: "#2f2d33", k: "#1c1b1f", c: "#4a4650", w: "#3b2716", W: "#5a3b20" };
const FLAME_W = 9, FLAME_H = 14, FLAME_FRAMES = 8;
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
      const sway = Math.sin(up * 2.5 + (f / FLAME_FRAMES) * Math.PI * 2) * 0.9 * up;
      // Teardrop: rounded at the base, widest a third of the way up, to a point.
      const halfW = 4.4 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.16 + up * 0.92)))) + 0.3;
      let row = "";
      for (let x = 0; x < FLAME_W; x++) {
        const across = Math.abs(x - (FLAME_W - 1) / 2 - sway) / halfW;
        const n = loopNoise(x * 0.7, up * 2 + (f / FLAME_FRAMES) * 4, 50);
        const heat = 1 - across - up * 0.45 + (n - 0.5) * (0.5 + up * 0.6); // licks more near the tip
        row += heat > 0.72 ? "4" : heat > 0.52 ? "3" : heat > 0.32 ? "2" : heat > 0.16 ? "1" : heat > 0.04 ? "0" : ".";
      }
      rows.push(row);
    }
    frames.push(spriteCanvas(rows, Object.fromEntries(FLAME_COLOURS.map((c, i) => [String(i), c]))));
  }
  return frames;
}

const bracketSprite = spriteCanvas(BRACKET, BRACKET_COLOURS);
const flames = flameFrames();
const scene = paintScene();

function drawScene(time) {
  ctx.imageSmoothingEnabled = false;
  const { canvas: art, OX, OY, lights } = scene;
  const at = (px, py) => [originX + (px - OX) * scale, originY + (py - OY) * scale];
  ctx.drawImage(art, ...at(0, 0), art.width * scale, art.height * scale);

  // Torchlight: each warm layer added on top, flickering with its flame.
  ctx.globalCompositeOperation = "lighter";
  lights.forEach(({ canvas: c, x0, y0 }, i) => {
    ctx.globalAlpha = flicker(time, i);
    ctx.drawImage(c, ...at(x0, y0), c.width * scale, c.height * scale);
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  TORCHES.forEach((t, i) => {
    const { wall } = torchWorld(t);
    const p = toScreen(...wall);
    const mirror = t.wall === "right" ? -1 : 1;
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.scale(mirror * scale, scale);
    ctx.drawImage(bracketSprite, 0, -BRACKET_ANCHOR);
    const frame = flames[Math.floor(time / 90 + i * 3) % FLAME_FRAMES];
    ctx.drawImage(frame, CUP_X + 0.5 - FLAME_W / 2, 1 - BRACKET_ANCHOR - FLAME_H);
    ctx.restore();
  });
}

// 0.7..1: a quick unsteady flicker, different for each torch.
function flicker(time, i) {
  const t = time / 1000;
  return 0.85 + 0.09 * Math.sin(t * 9.1 + i * 2.1) + 0.06 * Math.sin(t * 23.7 + i * 4.3);
}

// The player is a floating skull sprite, bobbing gently over its shadow.
// Side art faces left; the "right" facings mirror it. Each view is cut so the
// skull covers about the same area, so it keeps its size as it turns.
// Bump with index.html's ?v= so browsers fetch changed art instead of a cached copy.
const ASSET_VERSION = 17;
function loadImage(src) {
  const img = new Image();
  img.src = src + "?v=" + ASSET_VERSION;
  return img;
}
const skullFront = loadImage("assets/skull.png");
const skullThreeQuarter = loadImage("assets/skull-side.png");
const skullProfile = loadImage("assets/skull-profile.png");
const skullBackThreeQuarter = loadImage("assets/skull-back-side.png");
const skullBack = loadImage("assets/skull-back.png");
const SPRITES = {
  "front": skullFront,
  "left": skullProfile,
  "right": skullProfile,
  "front-left": skullThreeQuarter,
  "front-right": skullThreeQuarter,
  "back": skullBack,
  "back-left": skullBackThreeQuarter,
  "back-right": skullBackThreeQuarter,
};

// Facing front, bony hands float a little out from the jaw on both sides. The
// hand uses the skull's pixel size, colours and black outline, so they read as
// one drawing. Each hand bobs and sways on its own rhythm and trails the skull
// at its own pace, so the three parts drift apart and back together.
const hand = loadImage("assets/hand.png");
const HAND_OVERLAP = -2; // art px the hand tucks under the skull's side (negative: a gap)
const HAND_DROP = 6;     // art px the hand reaches below the skull
const HAND_SWAY = 1.5;   // art px of sideways drift
const hands = [
  // side: -1 left (as drawn), 1 right (mirrored); periods in ms; follow: how fast it catches up
  { side: -1, bobPeriod: 520, bobPhase: 1.3, swayPeriod: 830, swayPhase: 0.4, follow: 7, x: player.x, y: player.y },
  { side: 1, bobPeriod: 390, bobPhase: 4.1, swayPeriod: 670, swayPhase: 2.6, follow: 5, x: player.x, y: player.y },
];

function drawPlayer(time) {
  const cx = player.x + player.size / 2;
  const cy = player.y + player.size / 2;
  const foot = toScreen(cx, cy);
  const bob = (Math.sin(time / 450) + 1) / 2; // 0..1, slow up and down

  // Shadow on the floor, smaller while the skull is higher up.
  const r = TILE_W * scale * 0.24 * (1 - bob * 0.2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, r, r / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  const skull = SPRITES[player.facing];
  if (!skull.complete || !skull.naturalWidth) return;
  const zoom = scale; // sprites share the floor's art pixel size
  const w = Math.round(skull.naturalWidth * zoom);
  const h = Math.round(skull.naturalHeight * zoom);
  const baseLift = TILE_H * 0.35 * scale;
  const bobRange = TILE_H * 0.2 * scale;
  ctx.imageSmoothingEnabled = false;
  if (player.facing === "front") drawHands(time, zoom, baseLift, bobRange, w);
  ctx.save();
  ctx.translate(Math.round(foot.x), Math.round(foot.y - baseLift - bob * bobRange));
  const left = -Math.round(w / 2);
  if (player.facing.endsWith("right")) ctx.scale(-1, 1);
  ctx.drawImage(skull, left, -h, w, h);
  ctx.restore();
}

// Drawn behind the skull. Each hand sits beside where the skull's front view
// is (skullW wide), at its own trailing position, bob and sway.
function drawHands(time, zoom, baseLift, bobRange, skullW) {
  if (!hand.complete || !hand.naturalWidth) return;
  const hw = Math.round(hand.naturalWidth * zoom);
  const hh = Math.round(hand.naturalHeight * zoom);
  const gap = Math.round(skullW / 2) + Math.round((hand.naturalWidth - HAND_OVERLAP) * zoom);
  for (const h of hands) {
    const at = toScreen(h.x + player.size / 2, h.y + player.size / 2);
    const bob = (Math.sin(time / h.bobPeriod + h.bobPhase) + 1) / 2;
    const sway = Math.sin(time / h.swayPeriod + h.swayPhase) * HAND_SWAY * zoom;
    ctx.save();
    ctx.translate(Math.round(at.x + sway), Math.round(at.y - baseLift - bob * bobRange));
    // The left hand is drawn as is; the right is the same drawing mirrored.
    ctx.scale(-h.side, 1);
    ctx.drawImage(hand, -gap, Math.round(HAND_DROP * zoom) - hh, hw, hh);
    ctx.restore();
  }
}

function draw(time) {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawScene(time);
  drawPlayer(time);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); // cap so a background tab doesn't jump
  last = now;
  update(dt);
  draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
