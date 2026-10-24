// Bootstrap: Pixi app, landing page with attract mode, screens state machine, match lifecycle.

import { Application } from 'pixi.js';
import type { MatchConfig, MatchState } from './core/types';
import { NO_INPUTS } from './core/types';
import { createMatchState } from './core/state';
import { step, SIM_DT } from './core/step';
import { InputManager } from './engine/input';
import { GameLoop } from './engine/loop';
import { sfx } from './engine/sfx';
import { MatchRenderer } from './render/renderer';
import { createUI } from './ui/screens';
import { createLanding } from './ui/landing';
import './styles.css';

interface Match {
  state: MatchState;
  renderer: MatchRenderer;
  loop: GameLoop;
  paused: boolean;
  ftShown: boolean;
}

const app = new Application();
const input = new InputManager();
let match: Match | null = null;
let attract: { state: MatchState; renderer: MatchRenderer; loop: GameLoop } | null = null;

async function boot(): Promise<void> {
  await app.init({
    resizeTo: window,
    antialias: true,
    background: 0x0b0f14,
  });
  const host = document.getElementById('app');
  if (host) host.appendChild(app.canvas);

  input.attach();

  const ui = createUI((config) => {
    startMatch(ui, config);
  });

  // landing page first, with a live AI vs AI match playing behind it
  ui.hideMenu();
  const landing = createLanding(() => {
    sfx.init();
    landing.hide();
    stopAttract();
    ui.showMenu();
  });
  startAttract();

  // global keys
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') {
      const muted = sfx.toggle();
      ui.setMuted(muted);
      return;
    }
    if (e.code !== 'Escape') return;
    if (!match || match.state.finished) return;
    if (match.paused) {
      resumeMatch(ui);
    } else {
      pauseMatch(ui);
    }
  });
}

/** AI vs AI demo match rendered behind the landing overlay. */
function startAttract(): void {
  stopAttract();
  const state = createMatchState({
    mode: '11v11', homeTeam: 0, awayTeam: 2, difficulty: 'normal',
    halfSeconds: 3600, offside: true,
  });
  state.controlled = -1; // no human: everyone plays AI
  const renderer = new MatchRenderer(app, state);
  app.stage.addChild(renderer.world);
  app.stage.addChild(renderer.screenSpace);
  const loop = new GameLoop(
    SIM_DT,
    () => {
      renderer.savePrev(state);
      step(state, NO_INPUTS, SIM_DT);
      // restarts and kickoffs may re-assign a human; keep the demo fully AI
      state.controlled = -1;
    },
    (alpha) => {
      renderer.render(Math.max(0, Math.min(1, alpha)));
      if (state.finished) {
        stopAttract();
        startAttract();
      }
    },
  );
  attract = { state, renderer, loop };
  loop.start();
}

function stopAttract(): void {
  if (!attract) return;
  attract.loop.stop();
  attract.renderer.destroy();
  app.stage.removeChildren();
  attract = null;
}

function startMatch(ui: ReturnType<typeof createUI>, config: MatchConfig): void {
  stopAttract();
  teardownMatch();
  sfx.init();
  const state = createMatchState(config);
  const renderer = new MatchRenderer(app, state);
  app.stage.addChild(renderer.world);
  app.stage.addChild(renderer.screenSpace);

  // observed audio & juice: react to state changes without touching the pure core
  const obs = {
    touch: -1,
    score: -1,
    phase: '',
    restart: false,
  };

  const loop = new GameLoop(
    SIM_DT,
    () => {
      renderer.savePrev(state);
      const inputs = input.sample();
      step(state, inputs, SIM_DT);

      const speed = Math.hypot(state.ball.vx, state.ball.vy);
      if (state.ball.lastTouchPlayer !== obs.touch) {
        obs.touch = state.ball.lastTouchPlayer;
        if (speed > 9) {
          sfx.kick(Math.min(1, speed / 26));
          renderer.puff(state.ball.x, state.ball.y);
        } else if (speed > 3.2) {
          sfx.touch();
        }
      }
      const score = state.score[0] + state.score[1];
      if (score !== obs.score) {
        obs.score = score;
        sfx.goal();
        renderer.shake(0.55);
      }
      if (state.phase !== obs.phase) {
        obs.phase = state.phase;
        if (state.phase === 'halftime' || state.phase === 'fulltime') sfx.whistle(true);
        else if (state.phase === 'kickoff' || state.phase === 'restart') sfx.whistle(false);
      }
      const hasRestart = state.restart !== null;
      if (hasRestart !== obs.restart) {
        obs.restart = hasRestart;
        if (hasRestart) sfx.whistle(false);
      }
    },
    (alpha) => {
      renderer.render(Math.max(0, Math.min(1, alpha)));
      ui.updateHUD(state);
      ui.banner(state);
      if (state.finished && !match?.ftShown) {
        if (match) match.ftShown = true;
        window.setTimeout(() => {
          ui.showFulltime(
            state,
            () => startMatch(ui, config),
            () => { teardownMatch(); ui.showMenu(); },
          );
        }, 1400);
      }
    },
  );

  match = { state, renderer, loop, paused: false, ftShown: false };
  loop.start();
  ui.showMatch();
}

function pauseMatch(ui: ReturnType<typeof createUI>): void {
  if (!match || match.paused) return;
  match.paused = true;
  match.loop.stop();
  const m = match;
  ui.onPause(
    () => resumeMatch(ui),
    () => { teardownMatch(); startMatch(ui, m.state.config); },
    () => { teardownMatch(); ui.showMenu(); },
  );
}

function resumeMatch(ui: ReturnType<typeof createUI>): void {
  if (!match || !match.paused) return;
  match.paused = false;
  ui.hidePause();
  match.loop.start();
}

function teardownMatch(): void {
  if (!match) return;
  match.loop.stop();
  match.renderer.destroy();
  app.stage.removeChildren();
  match = null;
}

void boot();
