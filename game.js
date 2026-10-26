// Dungeon crawler — step 1: a red square that moves with WASD.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const player = { x: 0, y: 0, size: 32, speed: 240 }; // speed in pixels per second

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

// Start in the middle of the screen.
player.x = (canvas.width - player.size) / 2;
player.y = (canvas.height - player.size) / 2;

// Track which keys are held down.
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

function update(dt) {
  let dx = 0, dy = 0;
  if (keys.has("w")) dy -= 1;
  if (keys.has("s")) dy += 1;
  if (keys.has("a")) dx -= 1;
  if (keys.has("d")) dx += 1;

  // Keep diagonal movement the same speed as straight movement.
  if (dx && dy) {
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }

  player.x += dx * player.speed * dt;
  player.y += dy * player.speed * dt;

  // Stay on screen.
  player.x = Math.max(0, Math.min(canvas.width - player.size, player.x));
  player.y = Math.max(0, Math.min(canvas.height - player.size, player.y));
}

function draw() {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e33";
  ctx.fillRect(Math.round(player.x), Math.round(player.y), player.size, player.size);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); // cap so a background tab doesn't jump
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
