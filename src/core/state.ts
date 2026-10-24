// Match state creation and helpers to (re)position players.

import type { MatchConfig, MatchState, PlayerState, TeamSide } from './types';
import { FORMATIONS, MODES } from './constants';
import { clamp } from './math';

export function anchorWorld(
  _team: TeamSide, attackDir: number, fx: number, fy: number,
  pitchW: number, pitchH: number,
): { x: number; y: number } {
  // own goal line = -attackDir * W/2 ; fx 0..1 spans own goal -> opponent goal
  const x = -attackDir * (pitchW / 2) + attackDir * fx * pitchW;
  const y = (fy - 0.5) * pitchH;
  return { x, y };
}

export function createMatchState(config: MatchConfig): MatchState {
  const mode = MODES[config.mode];
  const slots = FORMATIONS[config.mode];
  const players: PlayerState[] = [];
  let id = 0;
  for (const side of [0, 1] as TeamSide[]) {
    // home attacks +x in the first half
    const attackDir = side === 0 ? 1 : -1;
    slots.forEach((slot, i) => {
      const a = anchorWorld(side, attackDir, slot.fx, slot.fy, mode.pitchW, mode.pitchH);
      const isGK = slot.role === 'GK' && mode.hasGK;
      players.push({
        id: id++,
        team: side,
        role: slot.role,
        num: i + 1,
        x: a.x, y: a.y,
        vx: 0, vy: 0,
        dvx: 0, dvy: 0,
        facing: attackDir > 0 ? 0 : Math.PI,
        ax: a.x, ay: a.y,
        tx: a.x, ty: a.y,
        isGK,
        touchCd: 0, lunge: 0, stun: 0, decCd: 0,
        aiDir: attackDir > 0 ? 0 : Math.PI,
      });
    });
  }

  const state: MatchState = {
    config,
    rng: (Math.floor(Math.random() * 0x7fffffff) | 0) || 12345,
    time: 0,
    half: 1,
    phase: 'kickoff',
    phaseTimer: 0,
    players,
    ball: {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      lastTouchPlayer: -1, lastTouchTeam: -1, heldBy: -1, heldTimer: 0,
    },
    score: [0, 0],
    possession: [0, 0],
    stats: [
      { passes: 0, passesOk: 0, shots: 0, shotsOnTarget: 0, streak: 0, bestStreak: 0 },
      { passes: 0, passesOk: 0, shots: 0, shotsOnTarget: 0, streak: 0, bestStreak: 0 },
    ],
    controlled: 0,
    switchCd: 0,
    attackDir: [1, -1],
    offsideFlags: [],
    offsideTeam: -1,
    pendingPass: null,
    restart: null,
    live: false,
    message: 'KICK-OFF',
    messageTimer: 1.2,
    inputs: {
      mx: 0, my: 0, sprint: false,
      pass: false, through: false, lob: false, shoot: false,
      switchPlayer: false, tackle: false,
    },
    prevInputs: null,
    prevTouchPlayer: -1,
    hold: { pass: 0, through: 0, lob: 0, shoot: 0 },
    queued: null,
    kickoffNext: 0,
    finished: false,
  };
  setupKickoff(state, 0);
  return state;
}

/** Put everyone at kickoff positions; `team` kicks off. Ball at center. */
export function setupKickoff(state: MatchState, team: TeamSide): void {
  const mode = MODES[state.config.mode];
  for (const p of state.players) {
    const dir = state.attackDir[p.team];
    // own half: the side of the goal this team defends (attackDir +1 -> own half is x < 0)
    if (dir > 0) {
      p.x = clamp(p.ax, -mode.pitchW / 2 + 1, -1.5);
    } else {
      p.x = clamp(p.ax, 1.5, mode.pitchW / 2 - 1);
    }
    p.y = clamp(p.ay, -mode.pitchH / 2 + 0.5, mode.pitchH / 2 - 0.5);
    if (p.isGK) {
      p.x = -dir * (mode.pitchW / 2 - 0.8);
      p.y = 0;
    }
    p.vx = 0; p.vy = 0; p.touchCd = 0; p.lunge = 0; p.stun = 0;
    p.facing = dir > 0 ? 0 : Math.PI;
    p.aiDir = p.facing;
  }
  // taker + support next to the ball
  const squad = state.players.filter((p) => p.team === team && !p.isGK);
  squad.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  const taker = squad[0];
  if (taker) {
    taker.x = -state.attackDir[team] * 1.0;
    taker.y = 0.4;
    const support = squad[1];
    if (support) {
      support.x = -state.attackDir[team] * 2.8;
      support.y = -2.2;
    }
  }
  const b = state.ball;
  b.x = 0; b.y = 0; b.z = 0; b.vx = 0; b.vy = 0; b.vz = 0;
  b.lastTouchPlayer = -1; b.lastTouchTeam = -1; b.heldBy = -1; b.heldTimer = 0;
  state.offsideFlags = [];
  state.offsideTeam = -1;
  state.pendingPass = null;
  state.live = false;
  state.phase = 'kickoff';
  state.restart = { kind: 'kickoff', team, x: 0, y: 0, taker: taker ? taker.id : -1 };
  state.kickoffNext = team;
  state.queued = null;
  // the user controls the taker when their team kicks off
  state.controlled = team === 0 && taker ? taker.id : pickInitialControlled(state);
}

export function pickInitialControlled(state: MatchState): number {
  const mine = state.players.filter((p) => p.team === 0 && !p.isGK);
  // start with the most advanced non-GK player (near where play begins)
  let best = mine[0];
  let bestScore = -Infinity;
  for (const p of mine) {
    const score = p.x * state.attackDir[0] - Math.abs(p.y) * 0.1;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best ? best.id : 0;
}

export function swapSides(state: MatchState): void {
  state.attackDir = [state.attackDir[1], state.attackDir[0]] as [number, number];
  // formation anchors are symmetric about the halfway line, so mirroring is enough
  for (const p of state.players) {
    p.ax = -p.ax;
    p.tx = p.ax;
    p.ty = p.ay;
  }
}
