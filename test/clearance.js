// Pure geometry check, no game loop: for every obstacle type and every speed,
// brute-force all jump timings and report the window of trigger distances that
// clear it. An empty window means the obstacle is impossible, which is the bug
// class that is invisible until you actually try to play.
//
//   node test/clearance.js

const path = require('path');
const os = require('os');

process.env.TERMINO_HISCORE = path.join(os.tmpdir(), 'termino-test-hiscore');

// The game boots a render loop on require, so stub a TTY and silence it.
process.stdout.isTTY = true;
Object.defineProperty(process.stdout, 'columns', { value: 84, configurable: true });
Object.defineProperty(process.stdout, 'rows', { value: 20, configurable: true });
const say = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;
process.stdin.resume = () => process.stdin;
process.stdin.pause = () => process.stdin;
process.stdin.setEncoding = () => process.stdin;
const stdinOn = process.stdin.on.bind(process.stdin);
process.stdin.on = (ev, fn) => (ev === 'data' ? process.stdin : stdinOn(ev, fn));

const game = require(path.join(__dirname, '..', 'bin', 'termino.js'));
process.stdout.write = say;

const { hits, cluster, sprites, tuning } = game;
const { DINO_RUN, DINO_STAND, DINO_DUCK, CACTI, BIRD } = sprites;
const { GRAVITY, JUMP_V, SPEED_START, SPEED_MAX } = tuning;

const GROUND = 60; // plenty of headroom; only relative geometry matters
const DINO_X = 6;

const TARGETS = [
  { name: 'cactus small', s: CACTI[0], lift: 0, rel: 1 },
  { name: 'cactus medium', s: CACTI[1], lift: 0, rel: 1 },
  { name: 'cactus tall', s: CACTI[2], lift: 0, rel: 1 },
  { name: 'cluster x2', s: cluster([CACTI[1], CACTI[0]]), lift: 0, rel: 1 },
  { name: 'cluster x3', s: cluster([CACTI[0], CACTI[0], CACTI[1]]), lift: 0, rel: 1 },
  { name: 'bird low', s: BIRD[0], lift: 2, rel: 1.25 },
  { name: 'bird mid', s: BIRD[0], lift: 9, rel: 1.25 },
  { name: 'bird high', s: BIRD[0], lift: 16, rel: 1.25 },
];

/** Simulate one pass. mode: 'jump' at trigger distance, 'duck', or 'run'. */
function survives(target, speed, mode, trigger) {
  const closing = speed * target.rel;
  let x = 40 + DINO_X + DINO_STAND.w; // start well clear on the right
  let y = 0;
  let vy = 0;
  let jumped = false;
  for (let t = 0; t < 400; t++) {
    const front = DINO_X + DINO_STAND.w;
    if (mode === 'jump' && !jumped && y === 0 && x - front <= trigger) {
      vy = JUMP_V;
      y = 0.01;
      jumped = true;
    }
    if (y > 0 || vy > 0) {
      vy -= GRAVITY;
      y += vy;
      if (y <= 0) {
        y = 0;
        vy = 0;
      }
    }
    x -= closing;

    const ds = mode === 'duck' && y === 0 ? DINO_DUCK[0] : y > 0 ? DINO_STAND : DINO_RUN[0];
    const dy = GROUND - ds.h - Math.round(y);
    const oy = GROUND - target.s.h - target.lift;
    if (hits(ds, DINO_X, dy, target.s, Math.round(x), oy)) return false;
    if (x + target.s.w < 0) return true;
  }
  return true;
}

function window(target, speed, mode) {
  const ok = [];
  for (let trig = 0; trig <= 40; trig += 0.5) {
    if (survives(target, speed, mode, trig)) ok.push(trig);
  }
  if (!ok.length) return null;
  return { lo: ok[0], hi: ok[ok.length - 1], count: ok.length };
}

let failures = 0;
const speeds = [SPEED_START, 1.8, 2.1, SPEED_MAX];
say('\nclearance windows (jump trigger distance in px, at each speed)\n\n');
say('obstacle          ' + speeds.map((s) => s.toFixed(2).padStart(13)).join('') + '\n');
say('-'.repeat(18 + 13 * speeds.length) + '\n');

for (const target of TARGETS) {
  const cells = [];
  for (const speed of speeds) {
    const jw = window(target, speed, 'jump');
    const duckOk = survives(target, speed, 'duck', 0);
    const runOk = survives(target, speed, 'run', 0);
    // jump window, then flags for the other two answers: D = duck, R = run past
    let cell = jw ? `${jw.lo}-${jw.hi}` : '-';
    cell += (duckOk ? 'D' : '') + (runOk ? 'R' : '') ? ' ' + (duckOk ? 'D' : '') + (runOk ? 'R' : '') : '';
    if (!jw && !duckOk && !runOk) {
      cell = 'IMPOSSIBLE';
      failures++;
    }
    cells.push(cell.padStart(13));
  }
  say(target.name.padEnd(18) + cells.join('') + '\n');
}

say('\nreference: dino ' + DINO_STAND.w + 'x' + DINO_STAND.h + ', duck ' + DINO_DUCK[0].w + 'x' + DINO_DUCK[0].h);
say(', peak ' + (JUMP_V * JUMP_V / (2 * GRAVITY)).toFixed(1) + 'px');
say(', airtime ' + (2 * JUMP_V / GRAVITY).toFixed(0) + ' ticks\n');
say(failures === 0 ? '\nPASS  every obstacle has a way through\n\n' : `\nFAIL  ${failures} impossible obstacle/speed combos\n\n`);
process.reallyExit(failures === 0 ? 0 : 1);
