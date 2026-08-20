# Termino

[![test](https://github.com/Whislyz/termino/actions/workflows/test.yml/badge.svg)](https://github.com/Whislyz/termino/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/@whislyz/termino)](https://www.npmjs.com/package/@whislyz/termino)
[![license](https://img.shields.io/npm/l/@whislyz/termino)](LICENSE)

An endless runner for your terminal. Type `termino` in any terminal and it
**splits the pane and starts the game beside you** — whatever was running in the
current pane keeps running. Built for the dead time in a long build, deploy, or
test suite.

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

## Install

```sh
npm install -g @whislyz/termino
```

The scope is only in the package name — the command it installs is plain
`termino`, on your `PATH`. No alias to add, no shell rc to edit, no
dependencies. From then on, in any terminal:

```sh
termino
```

Your pane splits, the game starts on the right and takes focus, and the thing
you were watching stays put on the left. Press `q` and the pane closes.

Just want to try it once without installing? `npx @whislyz/termino` behaves
identically — it splits too, launching the copy out of the npx cache.

### Where it can split

`termino` looks for a way to split, in this order, and uses the first one that
fits. A multiplexer wins over the terminal app, because when tmux is running
its panes are the ones you actually see.

| | how | needs |
| --- | --- | --- |
| tmux | `split-window -h` | `$TMUX` — works on any OS, any terminal |
| zellij | `action new-pane` | `$ZELLIJ` |
| iTerm2 | AppleScript | macOS Automation permission, asked once |
| WezTerm | `wezterm cli split-pane` | `$WEZTERM_PANE` |
| kitty | `kitten @ launch` | `allow_remote_control yes` in `kitty.conf` |
| Windows&nbsp;Terminal | `wt split-pane` | `$WT_SESSION` |
| Terminal.app | AppleScript | has no panes, so opens a new **window** |

Somewhere else entirely — Alacritty, a bare ssh session, VS Code's terminal —
nothing can split, so the game just plays in the current pane and says so. The
portable fix is to run it inside tmux.

To skip the split deliberately:

```sh
termino --here          # or: export TERMINO_HERE=1
termino --where         # names the splitter it would use, and exits
```

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
re-lays out mid-game.

Developed and played on macOS with iTerm2. The game logic is tested in CI on
Linux, macOS, and Windows across Node 18/20/22, and nothing outside the
splitters is platform-specific — but interactive play on Windows Terminal is
untested, so tell me if it misbehaves.

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

### Releasing

```sh
npm run release          # patch bump, or release:minor / release:major
```

That bumps the version, tags it, runs the gate, publishes, and pushes the
commit and tag. Plain `npm publish` works too and runs the same gate.

The gate is `scripts/preflight.js`, which stops the publish unless you are
logged in, the working tree is clean, you are on `main`, you are not behind
`origin/main`, and the version is not already on the registry. It runs before
the tests so the common mistakes fail in a second instead of after 30s of
autoplay. Run it alone with `npm run preflight`.

The working-tree check matters more than it looks: npm builds the tarball from
what is on disk, not from `HEAD`, so uncommitted edits ship silently and the
git tag then points at code nobody published.

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
