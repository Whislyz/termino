#!/usr/bin/env node
'use strict';

/**
 * Termino - an endless runner for the terminal.
 *
 * A dinosaur jumps cacti. Rendered with half-block characters so each terminal
 * cell holds two vertical pixels, which is what makes the sprites legible at
 * this size. Original art and code; no relation to Google or Chrome beyond the
 * genre. See README.md.
 *
 *   space / up / w  jump      down / s  duck        p  pause
 *   r  restart                q / ctrl-c  quit
 *
 * Zero dependencies, so it runs anywhere Node does.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// ---------------------------------------------------------------- tuning ----

const TICK_MS = 28;
// Peak = JUMP_V^2 / (2*GRAVITY) = 17px, airtime = 2*JUMP_V/GRAVITY = 25 ticks.
// What actually decides whether the game is fair is not the peak but the time
// spent ABOVE an obstacle: airtime * sqrt(1 - h/peak). For the 10px cactus that
// is 25 * 0.64 = 16 ticks, against the ~5 ticks the dino needs to carry its legs
// across a cactus stem. Raising the tallest cactus or lowering the peak eats
// that margin fast, so retune the pair together and re-run test/clearance.js.
const GRAVITY = 0.2176; // pixels per tick^2
const JUMP_V = 2.72; // pixels per tick
const FAST_FALL = 0.6; // extra gravity while holding down mid-air
// One jump covers speed * 25 pixels of ground. That has to comfortably exceed
// dino width (12) + obstacle width, otherwise the only way past a cactus is a
// last-instant jump and the game is hardest at the start. 1.5px/tick gives a
// ~20px wide window of workable jump timings from the very first obstacle.
const SPEED_START = 1.5; // pixels per tick
const SPEED_MAX = 2.4;
const SPEED_RAMP = 0.00022; // added per tick, reaches max in about two minutes
// Long enough that one keypress covers a full bird pass even if the terminal's
// auto-repeat delay is slow to kick in. Jumping cancels the crouch anyway.
const DUCK_HOLD_MS = 650;
const NIGHT_AT = 900; // score where the first night falls
const NIGHT_LEN = 900; // score span of one night
const MIN_COLS = 44;
const MIN_ROWS = 12;

// Overridable so the test harnesses cannot clobber a real player's best run.
const HISCORE_FILE =
  process.env.TERMINO_HISCORE || path.join(os.homedir(), '.termino-hiscore');

// ---------------------------------------------------------------- palette ---

// 0 is "empty". Everything else is an index into this table.
const PALETTE = [
  null,
  [217, 119, 87], // 1 dino (warm orange)
  [107, 191, 89], // 2 cactus
  [122, 122, 122], // 3 ground
  [74, 74, 85], // 4 cloud
  [143, 166, 184], // 5 bird
  [224, 108, 90], // 6 dino, dead
  [90, 90, 110], // 7 star
  [216, 210, 192], // 8 moon
];
const C_DINO = 1;
const C_CACTUS = 2;
const C_GROUND = 3;
const C_CLOUD = 4;
const C_BIRD = 5;
const C_DEAD = 6;
const C_STAR = 7;
const C_MOON = 8;

// ---------------------------------------------------------------- sprites ---

function sprite(rows) {
  return { w: Math.max(...rows.map((r) => r.length)), h: rows.length, rows };
}

// Every sprite is drawn on the shared pixel grid: two rows per terminal cell,
// so a 12-tall dino occupies 6 rows of text.
const DINO_BODY = [
  '.......#####',
  '.......##.##', // the gap is the eye
  '.......#####',
  '.......####.',
  '.......###..',
  '.#.....###..', // tail tip, far left
  '.##..######.',
  '.##########.',
  '..#########.',
  '..#######...',
];

const DINO_RUN = [
  sprite([...DINO_BODY, '...##.##....', '..###...#...']),
  sprite([...DINO_BODY, '...##.##....', '...#...###..']),
];
const DINO_STAND = sprite([...DINO_BODY, '...##.##....', '...##..##...']);
const DINO_DEAD = sprite([
  '.......#####',
  '.......#####', // eye shut
  '.......#####',
  '.......#.##.', // jaw open
  '.......###..',
  '.#.....###..',
  '.##..######.',
  '.##########.',
  '..#########.',
  '..#######...',
  '...##.##....',
  '...#.....#..',
]);

const DUCK_BODY = [
  '..............',
  '.........#####',
  '.#.......##.##',
  '.##......#####',
  '.#############',
  '..###########.',
];
const DINO_DUCK = [
  sprite([...DUCK_BODY, '..##...####...', '..#.....##....']),
  sprite([...DUCK_BODY, '..###..###....', '..#......##...']),
];

const CACTI = [
  sprite(['.##.', '.##.', '###.', '###.', '.##.', '.##.']),
  sprite(['..##..', '..##..', '#.##.#', '#.##.#', '######', '..##..', '..##..', '..##..']),
  sprite([
    '..##..',
    '..##..',
    '#.##..',
    '#.##.#',
    '####.#',
    '..####',
    '..##..',
    '..##..',
    '..##..',
    '..##..',
  ]),
];

// Flies leftward, so it faces left: beak at x=0, wing swept back.
const BIRD = [
  sprite([
    '........##',
    '.......###',
    '......####',
    '###.######',
    '.#########',
    '.....####.',
    '......##..',
    '..........',
  ]),
  sprite([
    '..........',
    '###.######',
    '.#########',
    '......####',
    '.....#####',
    '....####..',
    '...###....',
    '..##......',
  ]),
];

const CLOUD = sprite(['...####..', '..######.', '.########', '..#####..']);
const MOON = sprite(['.##.', '####', '####', '####', '####', '.##.']);

/** Glue small cacti together into a cluster sprite. */
function cluster(parts) {
  const h = Math.max(...parts.map((s) => s.h));
  const w = parts.reduce((n, s) => n + s.w, 0) + (parts.length - 1);
  const rows = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    parts.forEach((s, i) => {
      if (i) line += '.';
      const dy = y - (h - s.h); // bottom-align
      line += dy < 0 ? '.'.repeat(s.w) : s.rows[dy].padEnd(s.w, '.');
    });
    rows.push(line);
  }
  return sprite(rows);
}

// ------------------------------------------------------------------ state ---

const state = {
  cols: 0,
  rows: 0,
  pxW: 0,
  pxH: 0,
  groundY: 0, // pixel row of the ground surface
  px: null, // Uint8Array canvas
  paused: false,
  over: false,
  started: false, // has the player made their first move
  y: 0, // dino height above ground, in pixels
  vy: 0,
  duckUntil: 0,
  ducking: false,
  speed: SPEED_START,
  distance: 0,
  score: 0,
  hi: 0,
  tick: 0,
  obstacles: [],
  clouds: [],
  stars: [],
  nextObstacleIn: 0,
  flash: 0,
  night: 0, // 0..1 fade
};

// ------------------------------------------------------------- dimensions ---

function measure() {
  state.cols = Math.max(process.stdout.columns || 80, 1);
  state.rows = Math.max(process.stdout.rows || 24, 1);
  // row 0 = score, last row = hint, middle = canvas
  const canvasRows = Math.max(state.rows - 2, 1);
  state.pxW = state.cols;
  state.pxH = canvasRows * 2;
  // Keep the surface on an even pixel row so the ground line owns the top half
  // of its cell and the dino's feet land in the cell above it, never inside it.
  state.groundY = state.pxH - 4;
  state.px = new Uint8Array(state.pxW * state.pxH);
  state.stars = [];
  const starCount = Math.floor(state.cols / 12);
  for (let i = 0; i < starCount; i++) {
    state.stars.push({
      x: Math.floor((i + 0.5) * 12 + (i * 7) % 9),
      y: 1 + ((i * 5) % Math.max(Math.floor(state.groundY * 0.45), 2)),
    });
  }
}

function tooSmall() {
  return state.cols < MIN_COLS || state.rows < MIN_ROWS;
}

// ----------------------------------------------------------------- canvas ---

function clear() {
  state.px.fill(0);
}

function blit(s, x0, y0, color) {
  const { pxW, pxH, px } = state;
  for (let y = 0; y < s.h; y++) {
    const row = s.rows[y];
    const py = y0 + y;
    if (py < 0 || py >= pxH) continue;
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '#') continue;
      const pxx = x0 + x;
      if (pxx < 0 || pxx >= pxW) continue;
      px[py * pxW + pxx] = color;
    }
  }
}

function hSpan(y, x0, x1, color) {
  const { pxW, pxH, px } = state;
  if (y < 0 || y >= pxH) return;
  for (let x = Math.max(x0, 0); x < Math.min(x1, pxW); x++) px[y * pxW + x] = color;
}

/** Per-pixel collision between two placed sprites. */
function hits(a, ax, ay, b, bx, by) {
  if (ax + a.w <= bx || bx + b.w <= ax || ay + a.h <= by || by + b.h <= ay) return false;
  const x0 = Math.max(ax, bx);
  const x1 = Math.min(ax + a.w, bx + b.w);
  const y0 = Math.max(ay, by);
  const y1 = Math.min(ay + a.h, by + b.h);
  for (let y = y0; y < y1; y++) {
    const ra = a.rows[y - ay];
    const rb = b.rows[y - by];
    for (let x = x0; x < x1; x++) {
      if (ra[x - ax] === '#' && rb[x - bx] === '#') return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------- game ---

function resetRun() {
  state.y = 0;
  state.vy = 0;
  state.ducking = false;
  state.duckUntil = 0;
  state.speed = SPEED_START;
  state.distance = 0;
  state.score = 0;
  state.tick = 0;
  state.over = false;
  state.started = false;
  state.paused = false;
  state.flash = 0;
  state.night = 0;
  state.obstacles = [];
  state.nextObstacleIn = state.cols * 0.7;
  state.clouds = [
    { x: state.cols * 0.55, y: 3 },
    { x: state.cols * 0.95, y: 7 },
  ];
}

function dinoSprite() {
  if (state.over) return DINO_DEAD;
  if (state.ducking && state.y === 0) return DINO_DUCK[Math.floor(state.tick / 4) % 2];
  if (!state.started) return DINO_STAND;
  if (state.y > 0) return DINO_STAND;
  return DINO_RUN[Math.floor(state.tick / 4) % 2];
}

function dinoX() {
  return Math.max(Math.floor(state.cols * 0.08), 2);
}

function spawnObstacle() {
  const canFly = state.score > 350;
  const flying = canFly && Math.random() < 0.22;
  if (flying) {
    // low: must jump.  mid: must duck.  high: runs clean overhead.
    const levels = [2, 9, 16];
    const lift = levels[Math.floor(Math.random() * levels.length)];
    state.obstacles.push({
      kind: 'bird',
      x: state.pxW + 2,
      lift,
      frames: BIRD,
      s: BIRD[0],
    });
  } else {
    const r = Math.random();
    let s;
    if (r < 0.28) s = CACTI[2];
    else if (r < 0.5) s = cluster([CACTI[1], CACTI[0]]);
    // A three-wide cluster spans 16px, so it needs a faster world before one
    // jump can carry the dino all the way across it.
    else if (r < 0.62 && state.speed > 1.9) s = cluster([CACTI[0], CACTI[0], CACTI[1]]);
    else s = CACTI[Math.floor(Math.random() * 2)];
    state.obstacles.push({ kind: 'cactus', x: state.pxW + 2, lift: 0, s });
  }
  // The floor here has to stay above one jump's ground travel (speed * 24) so
  // the next obstacle never arrives while the dino is still airborne.
  const base = 30 + state.speed * 22;
  state.nextObstacleIn = base + Math.random() * base * 0.9;
}

function die() {
  state.over = true;
  state.flash = 6;
  if (state.score > state.hi) {
    state.hi = state.score;
    saveHi(state.hi);
  }
}

function update() {
  state.tick++;

  if (state.ducking && Date.now() > state.duckUntil) state.ducking = false;

  if (!state.started || state.over) {
    // idle: still animate clouds a touch so it does not look frozen
    if (!state.over) driftScenery(0.15);
    if (state.flash > 0) state.flash--;
    return;
  }

  state.speed = Math.min(SPEED_MAX, state.speed + SPEED_RAMP);
  state.distance += state.speed;
  state.score = Math.floor(state.distance / 3);

  // day / night cycle
  const cyc = state.score - NIGHT_AT;
  if (cyc <= 0) state.night = 0;
  else {
    const phase = (cyc % (NIGHT_LEN * 2)) / NIGHT_LEN; // 0..2
    state.night = phase < 1 ? Math.min(phase * 4, 1) : Math.max(1 - (phase - 1) * 4, 0);
  }

  // physics
  if (state.y > 0 || state.vy > 0) {
    state.vy -= GRAVITY;
    if (state.ducking && state.vy < 0) state.vy -= FAST_FALL;
    state.y += state.vy;
    if (state.y <= 0) {
      state.y = 0;
      state.vy = 0;
    }
  }

  driftScenery(1);

  // obstacles
  state.nextObstacleIn -= state.speed;
  if (state.nextObstacleIn <= 0) spawnObstacle();
  for (const o of state.obstacles) {
    o.x -= o.kind === 'bird' ? state.speed * 1.25 : state.speed;
    if (o.kind === 'bird') o.s = o.frames[Math.floor(state.tick / 6) % 2];
  }
  state.obstacles = state.obstacles.filter((o) => o.x + o.s.w > -1);

  // collision
  const ds = dinoSprite();
  const dx = dinoX();
  const dy = state.groundY - ds.h - Math.round(state.y);
  for (const o of state.obstacles) {
    const ox = Math.round(o.x);
    const oy = state.groundY - o.s.h - o.lift;
    if (hits(ds, dx, dy, o.s, ox, oy)) {
      die();
      break;
    }
  }
}

function driftScenery(mult) {
  for (const c of state.clouds) c.x -= 0.18 * mult * (state.speed / SPEED_START);
  state.clouds = state.clouds.filter((c) => c.x + CLOUD.w > -1);
  if (state.clouds.length < 3 && Math.random() < 0.01) {
    state.clouds.push({
      x: state.pxW + 2,
      y: 2 + Math.floor(Math.random() * Math.max(state.groundY * 0.4, 3)),
    });
  }
}

// ---------------------------------------------------------------- drawing ---

// A fixed strip of terrain noise, so pebbles scroll with the world instead of
// shimmering in place. Two bits per column: one per dirt row under the surface.
const TERRAIN = (() => {
  let seed = 20260820;
  const strip = new Uint8Array(521);
  for (let i = 0; i < strip.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const r = seed / 2147483648;
    strip[i] = (r < 0.05 ? 1 : 0) | (r > 0.97 ? 2 : 0);
  }
  return strip;
})();

function drawGround() {
  const g = state.groundY;
  hSpan(g, 0, state.pxW, C_GROUND);
  const off = Math.floor(state.distance);
  for (let x = 0; x < state.pxW; x++) {
    const bits = TERRAIN[(x + off) % TERRAIN.length];
    if (bits & 1) state.px[(g + 1) * state.pxW + x] = C_GROUND;
    if (bits & 2) state.px[(g + 2) * state.pxW + x] = C_GROUND;
  }
}

function drawFrame() {
  clear();

  if (state.night > 0.4) {
    const drift = Math.floor(state.distance / 14);
    for (const s of state.stars) {
      if (s.y >= state.pxH) continue;
      const x = ((s.x - drift) % state.pxW + state.pxW) % state.pxW;
      state.px[s.y * state.pxW + x] = C_STAR;
    }
    blit(MOON, Math.max(state.pxW - 8, 0), 2, C_MOON); // even row: no half-cell seam
  }

  for (const c of state.clouds) blit(CLOUD, Math.round(c.x), c.y, C_CLOUD);
  drawGround();

  for (const o of state.obstacles) {
    blit(o.s, Math.round(o.x), state.groundY - o.s.h - o.lift, o.kind === 'bird' ? C_BIRD : C_CACTUS);
  }

  const ds = dinoSprite();
  const color = state.over && state.flash % 2 === 0 ? C_DEAD : C_DINO;
  blit(ds, dinoX(), state.groundY - ds.h - Math.round(state.y), color);
}

const HALF_TOP = '▀';
const HALF_BOT = '▄';
const FULL = '█';

function fg(c) {
  return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
}
function bg(c) {
  return `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
}

function renderCanvas() {
  const { pxW, pxH, px } = state;
  const out = [];
  for (let r = 0; r < pxH / 2; r++) {
    let line = '';
    // Track the active colors so each frame only emits an escape when they
    // change; a full per-cell repaint is several times the bytes.
    let curFg = -1;
    let curBg = 0; // 0 is the terminal's own background
    for (let x = 0; x < pxW; x++) {
      const t = px[2 * r * pxW + x];
      const b = px[(2 * r + 1) * pxW + x];
      if (!t && !b) {
        if (curFg !== -1 || curBg !== 0) {
          line += '\x1b[0m';
          curFg = -1;
          curBg = 0;
        }
        line += ' ';
        continue;
      }
      let ch;
      let want;
      let wantBg = 0;
      if (t && b) {
        if (t === b) {
          ch = FULL;
          want = t;
        } else {
          ch = HALF_TOP;
          want = t;
          wantBg = b;
        }
      } else if (t) {
        ch = HALF_TOP;
        want = t;
      } else {
        ch = HALF_BOT;
        want = b;
      }
      if (want !== curFg) {
        line += fg(PALETTE[want]);
        curFg = want;
      }
      if (wantBg !== curBg) {
        line += wantBg ? bg(PALETTE[wantBg]) : '\x1b[49m';
        curBg = wantBg;
      }
      line += ch;
    }
    if (curFg !== -1 || curBg !== 0) line += '\x1b[0m';
    out.push(line);
  }
  return out;
}

function pad(n) {
  return String(n).padStart(5, '0');
}

/**
 * Where banner text can go. A centered line replaces the art on its row, so
 * both rows are kept above the dino's head no matter how short the pane is.
 * Returns [primary, secondary]; secondary is -1 when there is no room.
 */
function bannerRows() {
  const dinoTop = Math.floor((state.groundY - DINO_STAND.h) / 2);
  const a = Math.max(1, Math.min(3, dinoTop - 4));
  const b = a + 2;
  return [a, b < dinoTop ? b : -1];
}

function overlay(lines) {
  const w = state.cols;
  const [a, b] = bannerRows();
  if (state.over) {
    const hint = 'press  r  or  space  to run again';
    center(lines, a, 'G A M E   O V E R', '\x1b[1m' + fg(PALETTE[C_DINO]));
    if (b >= 0 && w >= hint.length + 2) center(lines, b, hint, '\x1b[2m');
  } else if (!state.started) {
    center(lines, a, 'press  space  to start', '\x1b[2m');
  } else if (state.paused) {
    center(lines, a, 'P A U S E D', '\x1b[1m');
  }
  return lines;
}

/** Replace the middle of a rendered row with text (drops that row's art). */
function center(lines, row, text, style) {
  if (row < 0 || row >= lines.length) return;
  const w = state.cols;
  if (text.length > w) text = text.slice(0, w);
  const left = Math.floor((w - text.length) / 2);
  lines[row] = ' '.repeat(left) + (style || '') + text + '\x1b[0m';
}

function draw() {
  if (tooSmall()) {
    const msg = `terminal too small (${state.cols}x${state.rows}) - need ${MIN_COLS}x${MIN_ROWS}`;
    process.stdout.write('\x1b[H\x1b[2J' + msg.slice(0, state.cols));
    return;
  }

  drawFrame();
  const lines = overlay(renderCanvas());

  // score line
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  const scoreText = (state.hi > 0 ? `${dim}HI${reset} ${dim}${pad(state.hi)}${reset}   ` : '') +
    (state.score > 0 && state.score % 100 < 6 && !state.over ? '\x1b[1m' : '') +
    pad(state.score) + reset;
  const scoreLen = (state.hi > 0 ? 3 + 5 + 3 : 0) + 5;
  const title = '\x1b[2mtermino\x1b[0m';
  const titleLen = 7;
  let top = '';
  if (state.cols >= titleLen + scoreLen + 3) {
    top = ' ' + title + ' '.repeat(state.cols - titleLen - scoreLen - 2) + scoreText;
  } else {
    top = ' '.repeat(Math.max(state.cols - scoreLen - 1, 0)) + scoreText;
  }

  const hintFull = 'space jump  ·  ↓ duck  ·  p pause  ·  r restart  ·  q quit';
  const hintShort = 'space  ↓  p  r  q';
  const hint = state.cols >= hintFull.length + 2 ? hintFull : hintShort;
  const bottom = '\x1b[2m ' + hint + '\x1b[0m';

  const body = lines.slice(0, Math.max(state.rows - 2, 0));
  const frame = '\x1b[H' + [top, ...body, bottom].map((l) => l + '\x1b[K').join('\r\n');
  process.stdout.write(frame);
}

// ------------------------------------------------------------- hi score ----

function loadHi() {
  try {
    const n = parseInt(fs.readFileSync(HISCORE_FILE, 'utf8').trim(), 10);
    if (Number.isFinite(n) && n >= 0) state.hi = n;
  } catch {
    /* first run */
  }
}

function saveHi(n) {
  try {
    fs.writeFileSync(HISCORE_FILE, String(n) + '\n');
  } catch {
    /* read-only home: score just won't persist */
  }
}

// ---------------------------------------------------------------- input ----

function jump() {
  if (state.over) return;
  if (!state.started) {
    state.started = true;
    return;
  }
  if (state.paused) return;
  if (state.y === 0) {
    state.vy = JUMP_V;
    state.y = 0.01;
    state.ducking = false;
  }
}

function duck() {
  if (!state.started || state.over || state.paused) return;
  state.ducking = true;
  state.duckUntil = Date.now() + DUCK_HOLD_MS;
}

function restart() {
  const hi = state.hi;
  resetRun();
  state.hi = hi;
  state.started = true;
}

function onKey(str) {
  if (str === '\x03' || str === 'q' || str === 'Q') return quit(0);
  switch (str) {
    case ' ':
    case '\r':
    case '\n':
    case 'w':
    case 'W':
    case '\x1b[A':
    case '\x1bOA':
      if (state.over) restart();
      else jump();
      break;
    case '\x1b[B':
    case '\x1bOB':
    case 's':
    case 'S':
      duck();
      break;
    case 'r':
    case 'R':
      restart();
      break;
    case 'p':
    case 'P':
      if (state.started && !state.over) state.paused = !state.paused;
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------- lifecycle ---

let timer = null;
let cleanedUp = false;

function enterScreen() {
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J');
}

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  if (timer) clearInterval(timer);
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
  }
  process.stdin.pause();
  process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
}

function quit(code) {
  cleanup();
  if (state.score > 0) {
    process.stdout.write(`termino - score ${pad(state.score)}  hi ${pad(state.hi)}\n`);
  }
  process.exit(code);
}

const HELP = [
  'termino - an endless runner for your terminal',
  '',
  '  usage: termino [--split]',
  '',
  '  --split      split the current iTerm2 pane and play in the new one,',
  '               leaving whatever runs on the left alone (macOS + iTerm2 only)',
  '  -h, --help   this',
  '',
  '  space / up / w   jump',
  '  down / s         duck (hold)',
  '  p                pause',
  '  r                restart',
  '  q / ctrl-c       quit',
  '',
  '  cacti and low birds: jump. mid-height birds: duck, they cannot be jumped.',
  '',
  `  high score file: ${HISCORE_FILE}`,
  '',
].join('\n');

/**
 * Open a second pane beside this one and start the game there. iTerm2 calls a
 * left/right divider a "vertical" split. The new session is captured in a
 * variable rather than re-read as "current session", because iTerm moves focus
 * to the new pane the moment it is created.
 */
function splitPane() {
  if (process.platform !== 'darwin' || process.env.TERM_PROGRAM !== 'iTerm.app') {
    process.stderr.write(
      '--split drives iTerm2 on macOS via AppleScript.\n' +
        `This is ${process.env.TERM_PROGRAM || 'an unrecognised terminal'}` +
        ` on ${process.platform}.\n` +
        'Split the window with your terminal\'s own shortcut, then run: termino\n'
    );
    process.exit(1);
  }
  const self = `'${process.execPath}' '${__filename}'`;
  const script = [
    'tell application "iTerm2"',
    '  tell current window',
    '    tell current session',
    '      set newSession to (split vertically with same profile)',
    '    end tell',
    '    tell newSession',
    `      write text "clear; ${self}"`,
    '      select',
    '    end tell',
    '  end tell',
    'end tell',
  ].join('\n');
  execFile('osascript', ['-e', script], (err, _stdout, stderr) => {
    if (err) {
      process.stderr.write(
        'Could not drive iTerm2. If macOS has not asked yet, allow automation\n' +
          'under System Settings > Privacy & Security > Automation, then retry.\n' +
          (stderr || err.message)
      );
      process.exit(1);
    }
  });
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes('--split')) {
    splitPane();
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('termino needs an interactive terminal.\n');
    process.exit(1);
  }

  loadHi();
  measure();
  resetRun();
  enterScreen();

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    // a held arrow key arrives as repeated 3-byte sequences in one chunk
    let i = 0;
    while (i < chunk.length) {
      if (chunk[i] === '\x1b' && i + 2 < chunk.length) {
        onKey(chunk.slice(i, i + 3));
        i += 3;
      } else {
        onKey(chunk[i]);
        i += 1;
      }
    }
  });

  process.stdout.on('resize', () => {
    measure();
    process.stdout.write('\x1b[2J');
  });

  process.on('SIGINT', () => quit(0));
  process.on('SIGTERM', () => quit(0));
  process.on('exit', cleanup);

  timer = setInterval(() => {
    if (tooSmall()) {
      draw();
      return;
    }
    if (!state.paused) update();
    draw();
  }, TICK_MS);
}

main();

// Seam for the offline test harness (see test/autoplay.js). Harmless when the
// game is run normally, since nothing requires this file.
module.exports = {
  state,
  dinoSprite,
  dinoX,
  hits,
  cluster,
  sprites: { DINO_RUN, DINO_STAND, DINO_DUCK, CACTI, BIRD },
  tuning: { TICK_MS, GRAVITY, JUMP_V, SPEED_START, SPEED_MAX },
};
