# Termino

An endless runner for your terminal. A dinosaur, some cacti, and nothing to
install. Built to sit in a split pane and give you something to do while a long
build, deploy, or test suite grinds away next to it.

```
 termino                                                          00268
            ██▀██
            ████▀                                                   ▄▄▄▄
      ▄     ███                                                   ▄█████
      ██▄▄██████                                                   ▀▀▀▀▀
       ███████▀▀
        ██ ▀█▄                                              ▄▄▄▄
                                                          ▄██████▄
                                                           ▀▀▀▀▀

          ██
        █ ██ █  ██
        ▀▀██▀▀ ███
          ██    ██
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█▀▀▀▀▀▀▀▀█▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█▀▀▀▀▀▀▀▀▀▀▀█▀▀
 space jump  ·  ↓ duck  ·  p pause  ·  r restart  ·  q quit
```

*(a real frame, mid-jump over a cactus cluster — it's in colour in the terminal)*

## Play

```sh
npx @whislyz/termino
```

That's it — no install, no dependencies. Or keep it around:

```sh
npm install -g @whislyz/termino
termino
```

### Beside something else

On macOS + iTerm2, let it split the window for you. Whatever is running in the
current pane stays put; the game opens on the right and takes focus:

```sh
termino --split
```

macOS will ask permission to control iTerm2 the first time (System Settings →
Privacy & Security → Automation). In any other terminal, use its own split
shortcut and run `termino` in the new pane.

## Controls

| key | |
| --- | --- |
| `space` / `↑` / `w` | jump |
| `↓` / `s` | duck (hold) |
| `p` | pause |
| `r` | restart |
| `q` / `ctrl-c` | quit |

Cacti and low pterodactyls: jump. **Mid-height pterodactyls: duck** — they fly
at exactly the wrong height and cannot be jumped. High ones pass overhead if you
keep running, and will hit you if you jump into them. The world speeds up for
about two minutes; night falls at 900.

High score lives in `~/.termino-hiscore` (override with `$TERMINO_HISCORE`).

## Requirements

Node 14 or newer, and a terminal with truecolor — which is nearly all of them
now. Wants a pane of at least 44×12; 80×20 or larger looks right. Resizing
re-lays out mid-game. Developed and played on macOS with iTerm2; the game itself
has no platform-specific code, only `--split` does.

## How it draws

Terminal cells are about twice as tall as they are wide, which is why most ASCII
games look squashed. Termino instead treats each cell as **two stacked pixels**
and picks one of `▀ ▄ █` per cell, giving a square-ish pixel grid of
`cols × (rows-2)*2`. Sprites are plain ASCII masks in the source, `#` for set:

```js
const DINO_BODY = [
  '.......#####',
  '.......##.##', // the gap is the eye
  '.......#####',
  ...
```

Collision runs per-pixel against those same masks, not against bounding boxes,
so the dino's legs can pass beside a cactus arm that a rectangle would call a
hit. Each frame is a single write, with colour escapes emitted only where the
colour actually changes.

## Development

```sh
git clone https://github.com/Whislyz/termino.git
cd termino
npm test
```

Both test harnesses fake a TTY, so they run headless over ssh or in CI.

**`test/clearance.js` is the one that matters.** Tuning a jump by feel does not
work here, because "feel" hides obstacles that are quietly impossible. It
brute-forces every jump timing against every obstacle at four speeds and prints
the window of trigger distances that survive:

```
obstacle                   1.50         1.80         2.10         2.40
----------------------------------------------------------------------
cactus tall                1-17       2.5-23.5     4.5-31.5     6.5-37.5
cluster x3                  0-8       0.5-16.5       0.5-23         2-28
bird mid                    - D          - D          - D          - D
```

An empty window means no player could ever get past that obstacle. It caught
three real bugs during development:

1. The tallest cactus was 12px while the jump peaked at 9.5px — unclearable.
2. After fixing that, one jump's *ground travel* was shorter than dino width +
   cactus width, so the dino landed back down onto the obstacle it had cleared.
3. Difficulty was inverted: the timing window was tightest on the very first
   obstacle and widened as the game sped up. That is why `SPEED_START` is
   1.5px/tick and not something gentler.

If you change `GRAVITY`, `JUMP_V`, `SPEED_START`, or any sprite height, re-run
it. `test/autoplay.js 120` then plays a bot for two minutes and expects zero
deaths as an end-to-end check.

## About the game

Termino is an original implementation, written from scratch. Endless runners
where a character jumps obstacles are a genre, and game mechanics are not
copyrightable — only specific code, art, and assets are. Every sprite here is a
hand-authored ASCII mask in `bin/termino.js`, and no code or artwork from
Chromium, Chrome, or any other implementation was copied or adapted.

Not affiliated with, sponsored by, or endorsed by Google. Chrome and Chromium
are trademarks of Google LLC, used here only to say what this project is *not*.

## License

MIT — see [LICENSE](LICENSE). Do what you like with it.
