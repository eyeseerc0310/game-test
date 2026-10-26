// Dungeon crawler — a floating skull exploring painted rooms. Each room is an
// animated image shown behind a see-through canvas; the game lays an
// isometric grid over its floor, keeps the skull to the walkable cobbles and
// away from the props, leads it through doorways to other rooms, and draws
// the skull on top.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- Rooms ----------
// A room is either coded pixels (pixels: a palette and rows, drawn on the
// canvas) or an animated image shown behind the see-through canvas.
// Everything about a room is measured in its own pixels ("room px"), and its
// floor has an isometric grid: tile (0, 0) is the
// back corner where the two back walls meet the floor, x runs down-right
// along the right-hand wall, y down-left along the left-hand wall. alongX
// and alongY are one tile's step in image px along each wall, measured from
// where the walls meet the floor (painted rooms aren't always exactly 2:1,
// or even symmetric).
const PROP_CLEARANCE = 11; // extra skull pixels kept clear around round props

// floor: the walkable cobbles traced from the image, kept a little in from
// the walls and short of broken edges. props: footprints the skull can't pass
// through, as ellipses (centre and radii) or polygons. doors: a doorway's
// opening in floor tiles (a stretch of the wall it's in, from the room side
// into the wall); stepping past the wall line leads to another room.
// torches: where a torch's flame stands in the image (the middle of its
// base); an animated flame and flickering glow are drawn over it.
const ROOMS = {
  tower: {
    pixels: TOWER_PIXELS,
    alongX: [10.1, 3.26],
    alongY: [-10.1, 3.55],
    backCorner: { x: 113.2, y: 71.1 },
    skullScale: 0.235, // room px per skull pixel: the skull's pixels are finer than the room's
    floor: [
      [113.2, 75.8], [207.4, 106.1], [212.8, 113.5], [180.3, 125.5], [153.2, 129.1], [144.2, 143.3],
      [129.8, 154.5], [100.9, 143.3], [84.7, 126.9], [59.4, 116.1], [39.9, 107.0], [36.9, 102.6],
    ],
    props: [
      { name: "barrel by the left wall", ellipse: [39.6, 91.6, 6.5, 3.3] },
      { name: "table", polygon: [[47.1, 82.5], [69.3, 72.9], [74.7, 78.0], [52.6, 88.0]] },
      { name: "pot by the table", ellipse: [75.3, 79.4, 3.2, 1.8] },
      { name: "barrels by the back wall", ellipse: [94.6, 70.7, 7.6, 3.3] },
      { name: "plank by the back wall", ellipse: [84.7, 72.2, 3.6, 1.8] },
      { name: "chest", polygon: [[112.6, 67.5], [122.6, 63.1], [132.9, 66.7], [122.9, 71.8]] },
      { name: "planks by the right wall", ellipse: [151.4, 76.5, 5.1, 2.5] },
      { name: "barrel under the torch", ellipse: [192.0, 98.8, 5.8, 2.7] },
      { name: "jar", ellipse: [200.5, 106.1, 3.2, 1.8] },
      { name: "barrel in the corner", ellipse: [211.0, 111.0, 5.8, 2.7] },
    ],
    // The archway in the right-hand wall (the wall at y = 0).
    doors: [{ wall: "right", from: 5.5, to: 6.4, leadsTo: "cellar", arrive: { x: 1.1, y: 6.5, facing: "front-right" } }],
    torches: [{ x: 71.7, y: 57.7 }, { x: 132.1, y: 42.8 }, { x: 202.1, y: 84.5 }],
  },
  cellar: {
    image: "room2",
    size: { w: 1509, h: 1042 },
    skullScale: 1.3, // room px per skull pixel
    alongX: [56, 28],
    alongY: [-56, 28],
    backCorner: { x: 765, y: 265 },
    floor: [
      [765, 299], [1240, 536], [1180, 570], [1060, 626], [962, 640], [905, 700], [782, 768],
      [700, 760], [470, 640], [420, 610], [300, 560], [262, 548],
    ],
    props: [
      { name: "crates", polygon: [[700, 300], [762, 270], [838, 306], [778, 338]] },
      { name: "plank", ellipse: [852, 318, 26, 14] },
      { name: "jar by the crates", ellipse: [706, 298, 22, 12] },
      { name: "jar by the left wall", ellipse: [520, 386, 24, 13] },
      { name: "barrel by the door", ellipse: [270, 496, 36, 20] },
      { name: "small jar", ellipse: [322, 472, 20, 11] },
      { name: "fallen stones", ellipse: [926, 352, 36, 18] },
      { name: "stairs", polygon: [[960, 395], [1060, 345], [1215, 430], [1120, 485]] },
      { name: "barrel by the stairs", ellipse: [1210, 488, 34, 19] },
    ],
    // The archway in the left-hand wall (the wall at x = 0).
    doors: [{ wall: "left", from: 5.9, to: 7.1, leadsTo: "tower", arrive: { x: 5.95, y: 1.3, facing: "front-left" } }],
  },
};
const DOOR_DEPTH = 0.6; // tiles of doorway floor behind the wall line
const FLOOR_INSET = 0.6; // tiles the traced floor stops short of the walls

let room = ROOMS.tower;
const roomImages = Object.fromEntries(Object.values(ROOMS).filter((r) => r.image).map((r) => [r.image, document.getElementById(r.image)]));

let scale = 1; // screen px per room px
let originX = 0; // screen position of the image's top-left corner
let originY = 0;

// A coded-pixel room's pixels, drawn once onto a canvas of its own.
function roomCanvas(pixels) {
  const c = document.createElement("canvas");
  c.width = pixels.width;
  c.height = pixels.height;
  const g = c.getContext("2d");
  const img = g.createImageData(c.width, c.height);
  const rgb = pixels.palette.map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
  pixels.rows.forEach((row, y) => {
    for (let x = 0; x < pixels.width; x++) {
      const o = (y * pixels.width + x) * 4;
      [img.data[o], img.data[o + 1], img.data[o + 2]] = rgb[parseInt(row.substr(x * 2, 2), 16)];
      img.data[o + 3] = 255;
    }
  });
  g.putImageData(img, 0, 0);
  return c;
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const size = room.pixels ? { w: room.pixels.width, h: room.pixels.height } : room.size;
  // Show the whole room, as large as fits, centred.
  scale = Math.min(canvas.width / size.w, canvas.height / size.h);
  if (room.pixels) {
    // Coded pixels: a whole-number zoom so every pixel is the same size. The
    // top and bottom of the picture are dark, so it may run off the screen a
    // little there to get the next size up.
    scale = Math.min(canvas.width / size.w, canvas.height / (size.h * 0.86));
    if (scale >= 1) scale = Math.floor(scale);
    room.canvas ||= roomCanvas(room.pixels);
  }
  originX = Math.round((canvas.width - size.w * scale) / 2);
  originY = Math.round((canvas.height - size.h * scale) / 2);
  for (const [name, img] of Object.entries(roomImages)) {
    if (name !== room.image) {
      img.style.display = "none";
      continue;
    }
    Object.assign(img.style, {
      display: "block",
      left: originX + "px",
      top: originY + "px",
      width: room.size.w * scale + "px",
      height: room.size.h * scale + "px",
      // Crisp pixels when enlarged; smooth when shrunk, so detail isn't dropped.
      imageRendering: scale >= 1 ? "pixelated" : "auto",
    });
  }
}
window.addEventListener("resize", resize);
resize();

// Floor (tile) coordinates -> room image px. z lifts a point straight up.
function toImage(x, y, z = 0) {
  return {
    x: room.backCorner.x + x * room.alongX[0] + y * room.alongY[0],
    y: room.backCorner.y + x * room.alongX[1] + y * room.alongY[1] - z * 2 * room.alongX[1],
  };
}

// Floor (tile) coordinates -> screen pixels.
function toScreen(x, y, z = 0) {
  const p = toImage(x, y, z);
  return { x: originX + p.x * scale, y: originY + p.y * scale };
}

function insidePolygon([px, py], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A doorway's floor, in tiles: across its opening, from inside the room
// (where the traced floor stops) to DOOR_DEPTH behind the wall line.
function doorArea(door) {
  const across = [door.from, door.to], into = [-DOOR_DEPTH, FLOOR_INSET + 0.4]; // overlaps the traced floor
  return door.wall === "left" ? { x: into, y: across } : { x: across, y: into };
}

function inArea(x, y, area) {
  return x >= area.x[0] && x <= area.x[1] && y >= area.y[0] && y <= area.y[1];
}

// The doorway the skull has stepped through, past its wall line, if any.
function doorAt(x, y) {
  return room.doors.find((d) => inArea(x, y, doorArea(d)) && (d.wall === "left" ? x : y) < 0);
}

// Can the skull's centre stand at this floor position?
function walkable(x, y) {
  if (room.doors.some((d) => inArea(x, y, doorArea(d)))) return true;
  const p = toImage(x, y);
  const at = [p.x, p.y];
  if (!insidePolygon(at, room.floor)) return false;
  return !room.props.some(({ ellipse, polygon }) => {
    if (polygon) return insidePolygon(at, polygon);
    // Kept a little further off than the footprint, so the skull's sprite
    // doesn't sit over the prop.
    const [cx, cy, rx, ry] = ellipse;
    const clear = PROP_CLEARANCE * room.skullScale; // in room px
    return ((p.x - cx) / (rx + clear)) ** 2 + ((p.y - cy) / (ry + clear / 2)) ** 2 < 1;
  });
}

// ---------- Moving between rooms ----------
// Through a doorway the screen fades to black, the next room is put in
// place with the skull just inside its doorway, and it fades back in.
const FADE = 0.45; // seconds each way
const transition = { t: 0, to: null, arrive: null, swapped: false }; // t runs 0..2 * FADE

function startTransition(door) {
  Object.assign(transition, { t: 0, to: door.leadsTo, arrive: door.arrive, swapped: false });
}

function updateTransition(dt) {
  if (!transition.to) return;
  transition.t += dt;
  if (!transition.swapped && transition.t >= FADE) {
    room = ROOMS[transition.to];
    resize();
    player.x = transition.arrive.x;
    player.y = transition.arrive.y;
    player.facing = transition.arrive.facing;
    for (const h of hands) Object.assign(h, { x: player.x, y: player.y });
    transition.swapped = true;
  }
  if (transition.t >= 2 * FADE) transition.to = null;
}

// How dark the screen is: 0 normally, 1 at the middle of a transition.
function fadeAmount() {
  if (!transition.to) return 0;
  const t = transition.t / FADE;
  const k = t < 1 ? t : 2 - t;
  return k * k * (3 - 2 * k); // ease in and out
}

// ---------- Torches ----------
// The rooms' torches are painted still, so a looping pixel-art flame is
// drawn over each one, in the image's own pixel size, with a warm glow that
// flickers with it.
const TORCH_PX = 1; // room px per pixel of the flame
const FLAME_W = 7, FLAME_H = 15, FLAME_FRAMES = 8;
const FLAME_COLOURS = ["#6e1a0e", "#c2401a", "#ec7a1c", "#f7c23a", "#fff1a8"]; // outer to core

function hash(a, b, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // 0..1
}

function pixelCanvas(w, h, colourAt) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const colour = colourAt(x, y);
      if (!colour) continue;
      g.fillStyle = colour;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// A teardrop eaten into by noise that rises through it; the noise repeats
// every 4 units, so the last frame runs back into the first.
function flameFrames() {
  const loopNoise = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const h = (a, b) => hash(a, ((b % 4) + 4) % 4, 50);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const top = h(i, j) + (h(i + 1, j) - h(i, j)) * sx;
    const bottom = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
    return top + (bottom - top) * sy;
  };
  return Array.from({ length: FLAME_FRAMES }, (_, f) => pixelCanvas(FLAME_W, FLAME_H, (x, y) => {
    const up = (FLAME_H - 1 - y) / (FLAME_H - 1); // 0 at the base, 1 at the tip
    const turn = (f / FLAME_FRAMES) * Math.PI * 2;
    const sway = Math.sin(up * 2.5 + turn) * 0.6 * up;
    const halfW = 3.4 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.16 + up * 0.92)))) + 0.3;
    const across = Math.abs(x - (FLAME_W - 1) / 2 - sway) / halfW;
    const n = loopNoise(x * 0.8, up * 2 + (f / FLAME_FRAMES) * 4);
    const heat = 1 - across - up * 0.45 + (n - 0.5) * (0.5 + up * 0.6); // licks more near the tip
    const band = heat > 0.72 ? 4 : heat > 0.52 ? 3 : heat > 0.32 ? 2 : heat > 0.16 ? 1 : heat > 0.04 ? 0 : -1;
    return FLAME_COLOURS[band];
  }));
}

// A warm glow in a few soft rings, added over the painting round each flame.
function glowSprite(r) {
  const c = document.createElement("canvas");
  c.width = c.height = 2 * r;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255, 150, 60, 0.35)");
  grad.addColorStop(0.4, "rgba(255, 120, 40, 0.12)");
  grad.addColorStop(1, "rgba(255, 100, 30, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 2 * r, 2 * r);
  return c;
}

const flames = flameFrames();
const GLOW_R = 25; // room px
const glow = glowSprite(GLOW_R);

// 0.7..1: a quick unsteady flicker, different for each torch.
function flicker(time, i) {
  const t = time / 1000;
  return 0.85 + 0.09 * Math.sin(t * 9.1 + i * 2.1) + 0.06 * Math.sin(t * 23.7 + i * 4.3);
}

function drawTorches(time) {
  ctx.imageSmoothingEnabled = false;
  (room.torches || []).forEach((t, i) => {
    const x = originX + t.x * scale, y = originY + t.y * scale;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = flicker(time, i);
    ctx.drawImage(glow, x - GLOW_R * scale, y - GLOW_R * 0.4 * scale - GLOW_R * scale, 2 * GLOW_R * scale, 2 * GLOW_R * scale);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const px = TORCH_PX * scale;
    const frame = flames[Math.floor(time / 90 + i * 3) % FLAME_FRAMES];
    ctx.drawImage(frame, Math.round(x - (FLAME_W / 2) * px), Math.round(y - FLAME_H * px), Math.round(FLAME_W * px), Math.round(FLAME_H * px));
  });
}

// ---------- Player ----------
// x, y: the skull's centre on the floor, in tiles; speed in tiles per second;
// facing is one of the keys of SPRITES below.
const player = { x: 5, y: 5, speed: 3.6, facing: "front" };

// Track which keys are held down.
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

const TURN_DELAY = 0.08; // seconds
let facingHeld = 0;

function update(dt) {
  updateTransition(dt);
  if (transition.to) return; // no moving while the screen fades

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

  // Same speed in every direction. When the way is blocked, try each floor
  // axis on its own, so the skull slides along walls and around props.
  const len = Math.hypot(dx, dy);
  if (len) {
    const mx = (dx / len) * player.speed * dt;
    const my = (dy / len) * player.speed * dt;
    if (walkable(player.x + mx, player.y + my)) { player.x += mx; player.y += my; }
    else if (walkable(player.x + mx, player.y)) player.x += mx;
    else if (walkable(player.x, player.y + my)) player.y += my;
    const door = doorAt(player.x, player.y);
    if (door) startTransition(door);
  }

  // Hands ease toward the skull, each at its own pace (frame-rate independent).
  for (const h of hands) {
    const k = 1 - Math.exp(-h.follow * dt);
    h.x += (player.x - h.x) * k;
    h.y += (player.y - h.y) * k;
  }
}

// The player is a floating skull sprite, bobbing gently over its shadow.
// Side art faces left; the "right" facings mirror it. Each view is cut so the
// skull covers about the same area, so it keeps its size as it turns.
// Bump with index.html's ?v= so browsers fetch changed art instead of a cached copy.
const ASSET_VERSION = 23;
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
  { side: -1, bobPeriod: 520, bobPhase: 1.3, swayPeriod: 830, swayPhase: 0.4, follow: 7, x: 5, y: 5 },
  { side: 1, bobPeriod: 390, bobPhase: 4.1, swayPeriod: 670, swayPhase: 2.6, follow: 5, x: 5, y: 5 },
];

function drawPlayer(time) {
  const foot = toScreen(player.x, player.y);
  const bob = (Math.sin(time / 450) + 1) / 2; // 0..1, slow up and down

  // Shadow on the floor, smaller while the skull is higher up.
  const zoom = room.skullScale * scale; // screen px per skull art px
  const r = 23 * zoom * (1 - bob * 0.2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, r, r / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  const skull = SPRITES[player.facing];
  if (!skull.complete || !skull.naturalWidth) return;
  const w = Math.round(skull.naturalWidth * zoom);
  const h = Math.round(skull.naturalHeight * zoom);
  const baseLift = 17 * zoom;
  const bobRange = 10 * zoom;
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
    const at = toScreen(h.x, h.y);
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

// With ?debug in the address, outline the floor and props the skull is kept to.
const DEBUG = new URLSearchParams(location.search).has("debug");

function drawBarriers() {
  const outline = (points, colour) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](originX + x * scale, originY + y * scale));
    ctx.closePath();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  outline(room.floor, "#3f6");
  for (const door of room.doors) {
    const a = doorArea(door);
    outline([[a.x[0], a.y[0]], [a.x[1], a.y[0]], [a.x[1], a.y[1]], [a.x[0], a.y[1]]].map(([x, y]) => {
      const p = toImage(x, y);
      return [p.x, p.y];
    }), "#4af");
  }
  for (const { ellipse, polygon } of room.props) {
    if (polygon) outline(polygon, "#f43");
    else {
      const [cx, cy, rx, ry] = ellipse;
      ctx.beginPath();
      ctx.ellipse(originX + cx * scale, originY + cy * scale, rx * scale, ry * scale, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "#f43";
      ctx.stroke();
    }
  }
}

function draw(time) {
  // The room image shows through the cleared canvas.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (room.canvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(room.canvas, originX, originY, room.canvas.width * scale, room.canvas.height * scale);
  }
  drawTorches(time);
  if (DEBUG) drawBarriers();
  drawPlayer(time);
  const fade = fadeAmount();
  if (fade > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${fade})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
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
