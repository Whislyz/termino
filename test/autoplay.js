// Offline harness: fakes a TTY, lets a bot play, and reports whether the game
// is actually survivable (jumps clear cacti, ducks clear mid-height birds).
//
//   node test/autoplay.js [seconds] [cols] [rows]
//
// Add DUMP=1 to print the last rendered frame with escapes stripped.

const path = require('path');
const os = require('os');

// The bot's scores are not anybody's high score.
process.env.TERMINO_HISCORE = path.join(os.tmpdir(), 'termino-test-hiscore');

const SECONDS = Number(process.argv[2] || 60);
const COLS = Number(process.argv[3] || 84);
const ROWS = Number(process.argv[4] || 20);

const say = process.stdout.write.bind(process.stdout);
let lastFrame = '';

process.stdout.isTTY = true;
Object.defineProperty(process.stdout, 'columns', { value: COLS, configurable: true });
Object.defineProperty(process.stdout, 'rows', { value: ROWS, configurable: true });
process.stdout.write = (s) => {
  lastFrame = String(s);
  return true;
};

let keys = null;
process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;
process.stdin.resume = () => process.stdin;
process.stdin.pause = () => process.stdin;
process.stdin.setEncoding = () => process.stdin;
const stdinOn = process.stdin.on.bind(process.stdin);
process.stdin.on = (ev, fn) => {
  if (ev === 'data') keys = fn;
  else stdinOn(ev, fn);
  return process.stdin;
};

const game = require(path.join(__dirname, '..', 'bin', 'termino.js'));
const { state, dinoSprite, dinoX } = game;

const press = (k) => keys(k);
press(' '); // start running

const report = {
  deaths: 0,
  best: 0,
  maxScore: 0,
  sawBird: false,
  sawDuckBird: false,
  sawNight: false,
  frames: 0,
};

const bot = setInterval(() => {
  report.frames++;
  if (state.night > 0.5) report.sawNight = true;

  if (state.over) {
    report.deaths++;
    report.best = Math.max(report.best, state.score);
    press('r');
    return;
  }
  report.maxScore = Math.max(report.maxScore, state.score);

  const ds = dinoSprite();
  const front = dinoX() + ds.w;
  let target = null;
  for (const o of state.obstacles) {
    const gap = o.x - front;
    if (gap < -o.s.w) continue;
    if (!target || gap < target.gap) target = { o, gap };
  }
  if (!target) return;

  const { o, gap } = target;
  // Aim for the middle of the window that test/clearance.js maps out.
  const lead = state.speed * 7;
  if (o.kind === 'bird' && o.lift >= 8 && o.lift < 14) {
    if (gap < state.speed * 16) press('\x1b[B'); // duck under it
  } else if (o.lift < 14) {
    if (gap > 0 && gap < lead) press(' ');
  }
}, 28);

setTimeout(() => {
  clearInterval(bot);
  report.best = Math.max(report.best, state.score);
  for (const o of state.obstacles) if (o.kind === 'bird') report.sawBird = true;

  process.stdout.write = say;
  if (process.env.DUMP) {
    const plain = lastFrame
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/\x1b\[\?[0-9]+[hl]/g, '');
    say(plain.split('\r\n').join('\n') + '\n');
  }
  say(
    [
      '',
      `played        ${SECONDS}s at ${COLS}x${ROWS}`,
      `frames        ${report.frames}`,
      `deaths        ${report.deaths}`,
      `best score    ${report.best}`,
      `final speed   ${state.speed.toFixed(2)} px/tick`,
      `night seen    ${report.sawNight}`,
      '',
      report.deaths === 0
        ? 'PASS  bot survived the whole run'
        : `NOTE  bot died ${report.deaths}x - check jump arc vs obstacle heights`,
      '',
    ].join('\n')
  );
  process.reallyExit(0);
}, SECONDS * 1000);
