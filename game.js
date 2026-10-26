// Dungeon crawler — isometric room with a floating skull that moves with WASD.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// The world is measured in tiles; the camera turns tiles into screen pixels.
const room = { w: 10, h: 10 };
// speed in tiles per second; facing is one of the keys of SPRITES below
const player = { x: 4.7, y: 4.7, size: 0.6, speed: 4, facing: "front" };

const TILE_W = 64; // width of one floor diamond on screen, before scaling
const TILE_H = 32; // height of one floor diamond (2:1 isometric)

let scale = 1;
let originX = 0;
let originY = 0;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Fit the whole room on screen with some margin, never bigger than 1.5x.
  const roomPxW = (room.w + room.h) * TILE_W / 2;
  const roomPxH = (room.w + room.h) * TILE_H / 2 + TILE_H * 2;
  scale = Math.min(1.5, (canvas.width * 0.9) / roomPxW, (canvas.height * 0.85) / roomPxH);

  // Put the middle of the room in the middle of the screen.
  originX = canvas.width / 2 - ((room.w - room.h) * TILE_W / 4) * scale;
  originY = canvas.height / 2 - ((room.w + room.h) * TILE_H / 4) * scale;
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
}

function polygon(points, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function drawFloor() {
  ctx.lineWidth = 1;
  for (let y = 0; y < room.h; y++) {
    for (let x = 0; x < room.w; x++) {
      const shade = (x + y) % 2 ? "#2a2a33" : "#26262e";
      polygon(
        [toScreen(x, y), toScreen(x + 1, y), toScreen(x + 1, y + 1), toScreen(x, y + 1)],
        shade,
        "#1b1b22"
      );
    }
  }
}

// The player is a floating skull sprite, bobbing gently over its shadow.
// Side art faces left; the "right" facings mirror it. Each view is cut so the
// skull covers about the same area, so it keeps its size as it turns.
// Bump with index.html's ?v= so browsers fetch changed art instead of a cached copy.
const ASSET_VERSION = 13;
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
const ART_W = 64; // reference width, so every sprite gets the same pixel size

// Facing front, bony hands float a little out from the jaw on both sides. The
// hand uses the skull's pixel size, colours and black outline, so they read as
// one drawing.
const hand = loadImage("assets/hand.png");
const HAND_OVERLAP = -2; // art px the hand tucks under the skull's side (negative: a gap)
const HAND_DROP = 6;     // art px the hand reaches below the skull

function drawPlayer(time) {
  const cx = player.x + player.size / 2;
  const cy = player.y + player.size / 2;
  const foot = toScreen(cx, cy);
  const bob = (Math.sin(time / 450) + 1) / 2; // 0..1, slow up and down

  // Shadow on the floor, smaller while the skull is higher up.
  const r = TILE_W * scale * 0.24 * (1 - bob * 0.2);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, r, r / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  const skull = SPRITES[player.facing];
  if (!skull.complete || !skull.naturalWidth) return;
  // Whole-number zoom when the art fits, so every art pixel is the same size.
  let zoom = (TILE_W * scale * 0.75) / ART_W;
  if (zoom >= 1) zoom = Math.floor(zoom);
  const w = Math.round(skull.naturalWidth * zoom);
  const h = Math.round(skull.naturalHeight * zoom);
  const lift = (TILE_H * 0.35 + bob * TILE_H * 0.2) * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.translate(Math.round(foot.x), Math.round(foot.y - lift));
  const left = -Math.round(w / 2);
  if (player.facing === "front" && hand.complete && hand.naturalWidth) {
    const hw = Math.round(hand.naturalWidth * zoom);
    const hh = Math.round(hand.naturalHeight * zoom);
    const hx = left - Math.round((hand.naturalWidth - HAND_OVERLAP) * zoom);
    const hy = Math.round(HAND_DROP * zoom) - hh;
    ctx.drawImage(hand, hx, hy, hw, hh);
    // The other hand is the same drawing mirrored around the skull's middle.
    ctx.save();
    ctx.translate(2 * left + w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(hand, hx, hy, hw, hh);
    ctx.restore();
  }
  if (player.facing.endsWith("right")) ctx.scale(-1, 1);
  ctx.drawImage(skull, left, -h, w, h);
  ctx.restore();
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
