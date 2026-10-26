// Dungeon crawler — a floating skull exploring rooms. A room is either
// painted in code from a layout (painted-room.js) or an animated image shown
// behind a see-through canvas. Either way the game lays an isometric grid
// over the floor, keeps the skull to the walkable cobbles and away from the
// props, leads it through doorways to other rooms, and draws the skull on top.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- Rooms ----------
// Every room's floor has the same kind of isometric grid: tile (0, 0) is the
// back corner where the two back walls meet the floor, x runs down-right
// along the right-hand wall and y down-left along the left-hand wall.
//
// Painted rooms are built from a layout (see painted-room.js) and measured in
// world px. Image rooms are measured in their image's pixels: one tile is
// 112 x 56 image px (2:1).
const TILE_W = 112;
const TILE_H = 56;
const SPRITE_ZOOM = 1.3; // image px per skull art px, in image rooms
const PROP_CLEARANCE = 14; // extra image px kept clear around round props

// Image rooms: floor is the walkable cobbles traced from the image, kept a
// little in from the walls and short of broken edges; props are footprints
// the skull can't pass through, as ellipses (centre and radii) or polygons.
// doors (any room): a doorway's opening in floor tiles (a stretch of the wall
// it's in, from the room side into the wall); stepping past the wall line
// leads to another room.
const ROOMS = {
  tower: {
    kind: "painted",
    layout: TOWER_TOP,
    // The archway in the right-hand wall (the wall at y = 0).
    doors: [{ wall: "right", from: 5.3, to: 6.3, leadsTo: "cellar", arrive: { x: 1.1, y: 6.5, facing: "front-right" } }],
  },
  cellar: {
    kind: "image",
    image: "room2",
    size: { w: 1509, h: 1042 },
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
    doors: [{ wall: "left", from: 5.9, to: 7.1, leadsTo: "tower", arrive: { x: 5.8, y: 0.9, facing: "front-left" } }],
  },
};
const DOOR_DEPTH = 0.6; // tiles of doorway floor behind the wall line
const FLOOR_INSET = 0.6; // tiles the traced floor stops short of the walls

let room = ROOMS.tower;
const roomImages = Object.fromEntries(Object.values(ROOMS).filter((r) => r.image).map((r) => [r.image, document.getElementById(r.image)]));

let scale = 1; // screen px per image px (image rooms) or per world px (painted rooms)
let spriteZoom = 1; // screen px per skull art px
let originX = 0; // screen position of the image's top-left corner, or of the painted room's back corner
let originY = 0;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (room.kind === "painted") {
    room.scene ||= paintRoom(room.layout);
    // Fit the room, from the tops of its walls down to a little of the
    // tower below its front corner. Whole-number zoom when it fits, so every
    // world pixel is the same size. Skull pixels are half a world pixel.
    const L = room.layout, above = 3.8 * WORLD_TILE_H, below = 1.5 * WORLD_TILE_H;
    const w = (L.w + L.h + 2 * WALL_T) * WORLD_TILE_W / 2;
    const h = above + (L.w + L.h) * WORLD_TILE_H / 2 + below;
    scale = Math.min(4, (canvas.width * 0.94) / w, (canvas.height * 0.94) / h);
    if (scale >= 1) scale = Math.floor(scale);
    spriteZoom = scale / 2;
    originX = Math.round(canvas.width / 2 - ((L.w - L.h) * WORLD_TILE_W / 4) * scale);
    originY = Math.round((canvas.height - h * scale) / 2 + above * scale);
  } else {
    // Show the whole image, as large as fits, centred.
    scale = Math.min(canvas.width / room.size.w, canvas.height / room.size.h);
    spriteZoom = SPRITE_ZOOM * scale;
    originX = Math.round((canvas.width - room.size.w * scale) / 2);
    originY = Math.round((canvas.height - room.size.h * scale) / 2);
  }
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

// Floor (tile) coordinates -> image px, in an image room. z lifts a point straight up.
function toImage(x, y, z = 0) {
  return {
    x: room.backCorner.x + (x - y) * (TILE_W / 2),
    y: room.backCorner.y + ((x + y) * (TILE_H / 2) - z * TILE_H),
  };
}

// Floor (tile) coordinates -> screen pixels.
function toScreen(x, y, z = 0) {
  if (room.kind === "painted") {
    return {
      x: originX + (x - y) * (WORLD_TILE_W / 2) * scale,
      y: originY + ((x + y) * (WORLD_TILE_H / 2) - z * WORLD_TILE_H) * scale,
    };
  }
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
  const across = [door.from, door.to], into = [-DOOR_DEPTH, FLOOR_INSET + 0.05];
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
  if (room.kind === "painted") return paintedWalkable(room.layout, x, y);
  const p = toImage(x, y);
  const at = [p.x, p.y];
  if (!insidePolygon(at, room.floor)) return false;
  return !room.props.some(({ ellipse, polygon }) => {
    if (polygon) return insidePolygon(at, polygon);
    // Kept a little further off than the footprint, so the skull's sprite
    // doesn't sit over the prop.
    const [cx, cy, rx, ry] = ellipse;
    return ((p.x - cx) / (rx + PROP_CLEARANCE)) ** 2 + ((p.y - cy) / (ry + PROP_CLEARANCE / 2)) ** 2 < 1;
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
const ASSET_VERSION = 22;
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
  const zoom = spriteZoom;
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
  if (room.kind === "painted") { // dots where the skull may stand
    ctx.fillStyle = "#3f6";
    for (let y = 0; y <= room.layout.h; y += 0.25) {
      for (let x = 0; x <= room.layout.w; x += 0.25) {
        if (!walkable(x, y)) continue;
        const p = toScreen(x, y);
        ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
      }
    }
    return;
  }
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
  // An image room shows through the cleared canvas; a painted room is drawn on it.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (room.kind === "painted") drawPaintedRoom(room.scene, time, ctx, toScreen, scale);
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
