// Dungeon crawler — a floating skull in a ruined tower-top room. The room is
// a painted, animated image (assets/room.gif) shown behind a see-through
// canvas; the game lays an isometric grid over its floor, keeps the skull to
// the walkable cobbles and away from the props, and draws the skull on top.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const roomImage = document.getElementById("room");

// ---------- The room image ----------
// Everything below is measured in pixels of the room image. The floor's grid:
// one tile is 112 x 56 image px (2:1 isometric), with tile (0, 0) at the back
// corner where the two back walls meet the floor. x runs down-right along the
// right-hand wall, y down-left along the left-hand wall.
const ROOM = { w: 1509, h: 1042 };
const TILE_W = 112;
const TILE_H = 56;
const BACK_CORNER = { x: 755, y: 262 };
const SPRITE_ZOOM = 1.3; // image px per skull art px

// Where the skull may go: the cobbled floor, traced from the image, kept a
// little in from the walls and short of the broken front edges.
const FLOOR = [
  [755, 296], [1308, 566], [1298, 588], [1250, 594], [1100, 606], [962, 630], [888, 684],
  [866, 812], [806, 842], [266, 578], [244, 546],
];
// Props it can't pass through: footprints on the floor, as ellipses
// (centre and radii) or polygons.
const PROPS = [
  { name: "barrel by the left wall", ellipse: [286, 502, 46, 26] },
  { name: "stool", ellipse: [346, 472, 30, 17] },
  { name: "table", polygon: [[340, 438], [492, 362], [522, 392], [372, 466]] },
  { name: "bucket", ellipse: [520, 380, 24, 14] },
  { name: "barrel on its side", ellipse: [615, 330, 44, 24] },
  { name: "chest", polygon: [[736, 318], [790, 292], [850, 322], [796, 352]] },
  { name: "planks and crates", ellipse: [940, 345, 44, 24] },
  { name: "jar", ellipse: [1268, 500, 30, 17] },
  { name: "barrel by the right wall", ellipse: [1328, 515, 40, 22] },
];

const PROP_CLEARANCE = 14; // extra image px kept clear around round props

let scale = 1; // screen px per image px
let originX = 0; // screen position of the image's top-left corner
let originY = 0;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  // Show the whole room, as large as fits, centred.
  scale = Math.min(canvas.width / ROOM.w, canvas.height / ROOM.h);
  originX = Math.round((canvas.width - ROOM.w * scale) / 2);
  originY = Math.round((canvas.height - ROOM.h * scale) / 2);
  Object.assign(roomImage.style, {
    left: originX + "px",
    top: originY + "px",
    width: ROOM.w * scale + "px",
    height: ROOM.h * scale + "px",
    // Crisp pixels when enlarged; smooth when shrunk, so detail isn't dropped.
    imageRendering: scale >= 1 ? "pixelated" : "auto",
  });
}
window.addEventListener("resize", resize);
resize();

// Floor (tile) coordinates -> room image px. z lifts a point straight up.
function toImage(x, y, z = 0) {
  return {
    x: BACK_CORNER.x + (x - y) * (TILE_W / 2),
    y: BACK_CORNER.y + ((x + y) * (TILE_H / 2) - z * TILE_H),
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

// Can the skull's centre stand at this floor position?
function walkable(x, y) {
  const p = toImage(x, y);
  const at = [p.x, p.y];
  if (!insidePolygon(at, FLOOR)) return false;
  return !PROPS.some(({ ellipse, polygon }) => {
    if (polygon) return insidePolygon(at, polygon);
    // Kept a little further off than the footprint, so the skull's sprite
    // doesn't sit over the prop.
    const [cx, cy, rx, ry] = ellipse;
    return ((p.x - cx) / (rx + PROP_CLEARANCE)) ** 2 + ((p.y - cy) / (ry + PROP_CLEARANCE / 2)) ** 2 < 1;
  });
}

// ---------- Player ----------
// x, y: the skull's centre on the floor, in tiles; speed in tiles per second;
// facing is one of the keys of SPRITES below.
const player = { x: 5.46, y: 5.18, speed: 3.6, facing: "front" };

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

  // Same speed in every direction. When the way is blocked, try each floor
  // axis on its own, so the skull slides along walls and around props.
  const len = Math.hypot(dx, dy);
  if (len) {
    const mx = (dx / len) * player.speed * dt;
    const my = (dy / len) * player.speed * dt;
    if (walkable(player.x + mx, player.y + my)) { player.x += mx; player.y += my; }
    else if (walkable(player.x + mx, player.y)) player.x += mx;
    else if (walkable(player.x, player.y + my)) player.y += my;
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
const ASSET_VERSION = 20;
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
  { side: -1, bobPeriod: 520, bobPhase: 1.3, swayPeriod: 830, swayPhase: 0.4, follow: 7, x: 5.46, y: 5.18 },
  { side: 1, bobPeriod: 390, bobPhase: 4.1, swayPeriod: 670, swayPhase: 2.6, follow: 5, x: 5.46, y: 5.18 },
];

function drawPlayer(time) {
  const foot = toScreen(player.x, player.y);
  const bob = (Math.sin(time / 450) + 1) / 2; // 0..1, slow up and down

  // Shadow on the floor, smaller while the skull is higher up.
  const zoom = SPRITE_ZOOM * scale; // screen px per skull art px
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
  outline(FLOOR, "#3f6");
  for (const { ellipse, polygon } of PROPS) {
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
  if (DEBUG) drawBarriers();
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
