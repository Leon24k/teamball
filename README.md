# Teamball ⚽

**Passing-first 2D football for the browser.** PES-style mechanics, three pitch sizes, one link to share. No install, no account, runs entirely client-side.

Built to the spec in [PRD.md](PRD.md).

## Features

- **3 formats, one engine**: 2v2 arcade mini pitch (no keeper), 5v5 futsal court, 11v11 full pitch with offside
- **PES-style controls**: assisted short passing with a power gauge, through balls into space, lofted long balls and crosses, shots you can aim across the goal mouth, sprint, tackles, and automatic player switching that follows the ball
- **A real football brain**: elastic formation anchors, off-ball runs that stay onside, pressing with goal-side cover, goalkeepers that narrow angles, and difficulty tiers (Easy / Normal / Hard) that genuinely play differently
- **Full match flow**: kickoff, kick-ins, corners, goal kicks, offsides, half-time side swap, and a full-time stats screen (possession, pass accuracy, best pass streak, shots)
- **Radar minimap** pinned to the bottom of the screen, the way it should be
- **Synthesized sound** (no audio assets): ball thumps, referee whistles, goal cheers. Press `M` to mute
- **Gamepad support** via the Gamepad API, mapped like a classic football game; keyboard and gamepad both work in the same match

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build (static output in `dist/`):

```bash
npm run build
npm run preview
```

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | `WASD` / arrows | left stick |
| Sprint | `Shift` | RT / RB |
| Short pass *(hold for power)* | `Space` | A |
| Through ball | `E` | Y |
| Long ball / cross *(hold for power)* | `Q` | X |
| Shoot *(hold for power)* | `F` | B |
| Switch player | `Tab` | LB |
| Tackle | `Ctrl` | - |
| Pause | `Esc` | Start |
| Mute | `M` | - |

Tips: holding a kick button traps the ball at your feet while you charge. Release to play it. Your aim direction picks the pass target.

## Deploy to Vercel

The game is 100% static, so deployment is one step. Easiest way:

1. Push this repo to GitHub.
2. On [vercel.com](https://vercel.com): **Add New Project**, then import `teamball`.
3. Framework preset **Vite** is auto-detected. Click **Deploy**.

Or with the CLI:

```bash
npm i -g vercel
vercel          # preview deploy
vercel --prod   # production
```

No environment variables, no server functions needed.

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| Build | Vite |
| Rendering | PixiJS v8 (WebGL/WebGPU) |
| Simulation | Custom deterministic core, fixed 60 Hz timestep, seeded RNG |
| Audio | WebAudio (synthesized, zero assets) |
| Tests | Vitest (headless match simulation) |

The whole simulation lives in `src/core/` with no DOM or rendering imports: pure `step(state, inputs, dt)`. That makes the gameplay unit-testable and replayable, keeps rendering and UI cleanly separated, and leaves the door open to port the core to Rust/WASM later (for rollback netcode) without touching anything else.

```
src/
  core/      # simulation: state, physics, actions, AI, rules, step
  engine/    # fixed-timestep loop, input (keyboard + gamepad), sfx
  render/    # Pixi scene: pitch, players, ball, camera, radar, effects
  ui/        # landing page, menu, HUD, pause, full-time (DOM)
```

All gameplay tuning lives in one file: `src/core/constants.ts`.

## Development

```bash
npm test                                  # headless match simulation tests
npx vite-node scripts/balance-check.ts    # simulate full matches per mode
npx vite-node scripts/instrument.ts 11v11 # trace match events (debug)
```

## Status

**v0.2, playable end to end.** Everything listed in Features works. Player visuals are clean procedural placeholders (colored discs with facing indicators); character sprites and animation are the next milestone, followed by replays and local 2-player. See the roadmap in [PRD.md](PRD.md).

## License

MIT (see [LICENSE](LICENSE)).
