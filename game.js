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
  const roomPxW = (room.w + room.h) * TILE_W / 2;
  const roomPxH = (room.w + room.h) * TILE_H / 2 + TILE_H * 2;
  scale = Math.min(3, (canvas.width * 0.9) / roomPxW, (canvas.height * 0.85) / roomPxH);
  if (scale >= 1) scale = Math.floor(scale);

  // Put the middle of the room in the middle of the screen, on a whole pixel.
  originX = Math.round(canvas.width / 2 - ((room.w - room.h) * TILE_W / 4) * scale);
  originY = Math.round(canvas.height / 2 - ((room.w + room.h) * TILE_H / 4) * scale);
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

// ---------- Cobblestone floor ----------
// Painted once, pixel by pixel, at art resolution. Stones are a jittered
// Voronoi pattern laid out on the floor itself (so they're squashed by the
// isometric view), joined by black mortar, lit from the top-left, and limited
// to a small stone palette that shares the skull's outline black. Sparse moss
// grows in the joints, and a few puddles sit in the low spots with water
// running out along the joints around them.
const STONES_PER_TILE = 3;
const SLAB = 10; // art px of stone edge visible below the floor's front sides
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

const floorArt = paintFloor();

function paintFloor() {
  const ox = room.h * TILE_W / 2; // art x of the floor's top corner
  const W = (room.w + room.h) * TILE_W / 2;
  const H = (room.w + room.h) * TILE_H / 2 + SLAB;
  const art = document.createElement("canvas");
  art.width = W;
  art.height = H;
  const g = art.getContext("2d");
  const rgb = [MORTAR, ...STONE, ...MOSS, ...WATER].map((c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)));
  const img = g.createImageData(W, H);
  const put = (px, py, colour) => {
    const o = (py * W + px) * 4;
    [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]] = [...rgb[colour], 255];
  };

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      // Art pixel centre -> floor position in tiles.
      const a = (px + 0.5 - ox) / (TILE_W / 2);
      const b = (py + 0.5) / (TILE_H / 2);
      const x = (a + b) / 2;
      const y = (b - a) / 2;
      if (x >= 0 && x < room.w && y >= 0 && y < room.h) {
        put(px, py, floorColour(x, y, px, py));
        continue;
      }
      // Below the two front edges: the slab's cut stone sides.
      const xe = a + room.h, ye = room.w - a; // where straight up meets each edge
      const downL = py + 0.5 - (xe + room.h) * TILE_H / 2;
      const downR = py + 0.5 - (room.w + ye) * TILE_H / 2;
      if (xe >= 0 && xe <= room.w && downL > 0 && downL <= SLAB) put(px, py, P_STONE + sideShade(xe, downL, 2));
      else if (ye >= 0 && ye <= room.h && downR > 0 && downR <= SLAB) put(px, py, P_STONE + sideShade(ye, downR, 1));
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas: art, ox };
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

// Cut-stone side of the slab: two courses of blocks; `lit` is 2 on the
// left face (towards the light) and 1 on the right.
function sideShade(along, down, lit) {
  const course = down <= SLAB / 2 ? 0 : 1;
  if (Math.abs(down - SLAB / 2) < 0.5 || down > SLAB - 1) return -1; // mortar between courses, dark bottom
  const u = along * 54 + course * 9; // art px along the edge, courses offset
  if (u % 18 < 1) return -1; // vertical joints
  return Math.max(0, lit - (course ? 1 : 0) - (hash(Math.floor(u / 18), course, 6) < 0.3 ? 1 : 0));
}

function drawFloor() {
  ctx.imageSmoothingEnabled = false;
  const { canvas: art, ox } = floorArt;
  ctx.drawImage(art, originX - ox * scale, originY, art.width * scale, art.height * scale);
}

// The player is a floating skull sprite, bobbing gently over its shadow.
// Side art faces left; the "right" facings mirror it. Each view is cut so the
// skull covers about the same area, so it keeps its size as it turns.
// Bump with index.html's ?v= so browsers fetch changed art instead of a cached copy.
const ASSET_VERSION = 16;
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
  drawFloor();
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
