// Top-level deterministic match step: inputs -> decisions -> physics -> rules.
// step() must stay free of Date.now()/Math.random(): replay & netcode depend on it.

import type { Inputs, MatchState, QueuedActionType } from './types';
import { HOLD_TIME, JOG_SPEED, SPRINT_SPEED } from './constants';
import {
  ballController, ballInteract, stepBall, stepPlayers,
} from './physics';
import { computeAI } from './ai';
import {
  canKick, executeLob, executePass, executeShoot, executeThrough,
  queueAction, startTackle, trySwitch,
} from './actions';
import { checkBall, clock } from './rules';

export const SIM_DT = 1 / 60;

const FROZEN = new Set(['goal', 'halftime', 'fulltime']);
const POWER_KEYS = ['pass', 'through', 'lob', 'shoot'] as const;

export function step(state: MatchState, inputs: Inputs, dt: number): void {
  if (state.finished) return;
  state.inputs = { ...inputs };
  const prev = state.prevInputs;
  const user = state.players[state.controlled];
  const frozen = FROZEN.has(state.phase);

  // ---- user button holds -> power gauge; release edges -> kick ----
  for (const k of POWER_KEYS) {
    if (inputs[k]) {
      state.hold[k] = Math.min(1, state.hold[k] + dt / HOLD_TIME);
    } else if (prev && prev[k] && state.hold[k] > 0) {
      const power = Math.max(0.15, state.hold[k]);
      state.hold[k] = 0;
      userKick(state, k, power);
    } else {
      state.hold[k] = 0;
    }
  }

  // ---- user movement ----
  if (user) {
    if (frozen || user.stun > 0 || user.lunge > 0) {
      user.dvx = 0; user.dvy = 0;
    } else {
      const mag = Math.min(1, Math.hypot(inputs.mx, inputs.my));
      if (mag > 0.05) {
        const spd = inputs.sprint ? SPRINT_SPEED : JOG_SPEED;
        const inv = mag > 0 ? 1 / Math.hypot(inputs.mx, inputs.my) : 0;
        user.dvx = inputs.mx * inv * spd * mag;
        user.dvy = inputs.my * inv * spd * mag;
      } else {
        user.dvx = 0; user.dvy = 0;
      }
    }
  }

  // ---- user edges: tackle & switch ----
  if (user && !frozen) {
    if (inputs.tackle && !(prev && prev.tackle)) {
      const ctrl = ballController(state);
      if (!ctrl || ctrl.team !== 0 || ctrl.id === user.id) startTackle(state, user);
    }
    if (inputs.switchPlayer && !(prev && prev.switchPlayer)) {
      // PES-style: no manual switching away while your own team carries the ball
      const carrier2 = ballController(state);
      const toucher = state.ball.lastTouchPlayer >= 0 ? state.players[state.ball.lastTouchPlayer] : undefined;
      const oursCarrying = (carrier2 && carrier2.team === 0)
        || (toucher && toucher.team === 0
          && Math.hypot(toucher.x - state.ball.x, toucher.y - state.ball.y) < 3.2);
      if (!oursCarrying) trySwitch(state);
    }
  }

  // ---- AI for everyone else ----
  computeAI(state, dt);

  // ---- queued action (input buffering) ----
  if (state.queued && user) {
    state.queued.life -= dt;
    if (state.queued.life <= 0) {
      state.queued = null;
    } else if (!frozen && canKick(state, user)) {
      const q = state.queued;
      state.queued = null;
      userKick(state, q.type, q.power);
    }
  }

  // ---- physics ----
  stepPlayers(state, dt);
  stepBall(state, dt);
  ballInteract(state);

  // ---- rules ----
  checkBall(state);
  clock(state, dt);

  // ---- timers ----
  for (const p of state.players) {
    if (p.touchCd > 0) p.touchCd = Math.max(0, p.touchCd - dt);
    if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
    if (p.lunge > 0) {
      p.lunge -= dt;
      if (p.lunge <= 0) {
        p.lunge = 0;
        p.stun = Math.max(p.stun, 0.35); // whiffed tackle: brief recovery
      }
    }
  }
  if (state.switchCd > 0) state.switchCd = Math.max(0, state.switchCd - dt);

  // ---- auto switching (PES-style: follow the ball) ----
  autoSwitch(state);

  state.prevTouchPlayer = state.ball.lastTouchPlayer;
  state.prevInputs = { ...inputs };
}

function userKick(state: MatchState, type: QueuedActionType, power: number): void {
  const p = state.players[state.controlled];
  if (!p || FROZEN.has(state.phase)) return;
  if (!canKick(state, p)) {
    queueAction(state, type, power);
    return;
  }
  const { mx, my } = state.inputs;
  const hasAim = Math.hypot(mx, my) > 0.25;
  const ax = hasAim ? mx : Math.cos(p.facing);
  const ay = hasAim ? my : Math.sin(p.facing);
  switch (type) {
    case 'pass': executePass(state, p, power, ax, ay); break;
    case 'through': executeThrough(state, p, power, ax, ay); break;
    case 'lob': executeLob(state, p, power, ax, ay); break;
    case 'shoot': executeShoot(state, p, power, ay); break;
  }
  state.queued = null;
}

function autoSwitch(state: MatchState): void {
  // controlled < 0 means no human (attract mode): everyone is AI
  if (state.phase !== 'play' || state.controlled < 0) return;
  const b = state.ball;

  // control follows whoever on my team is carrying the ball
  // (last toucher still near it: covers receivers between touch cooldowns)
  const toucher = b.lastTouchPlayer >= 0 ? state.players[b.lastTouchPlayer] : undefined;
  if (toucher && toucher.team === 0 && !toucher.isGK
    && Math.hypot(toucher.x - b.x, toucher.y - b.y) < 3) {
    if (toucher.id !== state.controlled && state.switchCd <= 0) {
      state.controlled = toucher.id;
      state.switchCd = 0.3;
    }
    return;
  }

  // opponent has it (or loose ball far from us): control the nearest defender
  const ctrl = ballController(state);
  if ((!ctrl || ctrl.team === 1) && state.switchCd <= 0) {
    let best = null as null | (typeof state.players)[number];
    let bestD = Infinity;
    for (const q of state.players) {
      if (q.team !== 0 || q.isGK) continue;
      const d = Math.hypot(q.x - b.x, q.y - b.y);
      if (d < bestD) { bestD = d; best = q; }
    }
    const cur = state.players[state.controlled];
    const curD = cur ? Math.hypot(cur.x - b.x, cur.y - b.y) : Infinity;
    if (best && cur && best.id !== cur.id && bestD + 0.8 < curD) {
      state.controlled = best.id;
      state.switchCd = 0.6;
    }
  }
}

/** Simulate headlessly (tests, future replays/bots). */
export function simulate(state: MatchState, seconds: number, inputs?: Inputs): void {
  const ticks = Math.round(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) step(state, inputs ?? neutralInputs(), SIM_DT);
}

function neutralInputs(): Inputs {
  return {
    mx: 0, my: 0, sprint: false,
    pass: false, through: false, lob: false, shoot: false,
    switchPlayer: false, tackle: false,
  };
}
