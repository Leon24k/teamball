// Match rules: goals, out of bounds, offside, restarts, clock & phases, stats events.

import type { MatchState, PlayerState, RestartKind, TeamSide } from './types';
import { MODES, GOAL_BANNER, HALF_BANNER, OPP_CLEAR_R, RESTART_FREEZE } from './constants';
import { clamp } from './math';
import { setupKickoff, swapSides } from './state';
import { possessionTeam } from './physics';

/** Called by physics/actions on every ball contact (kick, touch, catch). */
export function onBallTouched(state: MatchState, toucher: PlayerState): void {
  // first touch puts the ball back in play
  if (state.phase === 'restart' || state.phase === 'kickoff') {
    state.phase = 'play';
    state.restart = null;
  }
  state.live = true;

  // offside offence: a flagged player being first to play the ball
  if (state.offsideTeam === toucher.team && state.offsideFlags.includes(toucher.id)) {
    whistleOffside(state, toucher);
    return;
  }
  state.offsideTeam = -1;
  state.offsideFlags = [];

  const pp = state.pendingPass;
  if (pp && pp.passer !== toucher.id) {
    if (pp.team === toucher.team) {
      if (!pp.isShot) {
        const st = state.stats[toucher.team];
        st.passesOk++;
        st.streak++;
        if (st.streak > st.bestStreak) st.bestStreak = st.streak;
      }
    } else {
      state.stats[0].streak = 0;
      state.stats[1].streak = 0;
      if (pp.isShot && toucher.isGK) {
        // goalkeeper save: shot was on target
        state.stats[pp.team].shotsOnTarget++;
      }
    }
    state.pendingPass = null;
  }
}

/**
 * Record potential offside positions at the moment a pass leaves the kicker's boot.
 * Called by kickBall for pass/through/lob (not shots/clearances).
 */
export function recordOffside(state: MatchState, kicker: PlayerState): void {
  // a flagged player playing the ball himself is also an offence
  if (state.offsideTeam === kicker.team && state.offsideFlags.includes(kicker.id)) {
    whistleOffside(state, kicker);
    return;
  }
  state.offsideTeam = -1;
  state.offsideFlags = [];
  const mode = MODES[state.config.mode];
  if (!state.config.offside || !mode.offside) return;

  const att = state.attackDir[kicker.team];
  const def: TeamSide = kicker.team === 0 ? 1 : 0;
  // depth in the attacking direction: bigger = closer to the defenders' goal
  const metrics = state.players
    .filter((p) => p.team === def)
    .map((p) => p.x * att)
    .sort((a, b) => b - a);
  const secondLast = metrics[1] ?? metrics[0] ?? 0;
  const line = Math.max(secondLast, state.ball.x * att, 0);

  const flags: number[] = [];
  for (const m of state.players) {
    if (m.team !== kicker.team || m.id === kicker.id) continue;
    if (m.x * att > line + 0.5) flags.push(m.id);
  }
  if (flags.length > 0) {
    state.offsideTeam = kicker.team;
    state.offsideFlags = flags;
  }
}

function whistleOffside(state: MatchState, player: PlayerState): void {
  const def: TeamSide = player.team === 0 ? 1 : 0;
  state.offsideTeam = -1;
  state.offsideFlags = [];
  state.pendingPass = null;
  setRestart(state, 'freekick', def, player.x, clamp(player.y, -30, 30), 'OFFSIDE');
}

/** Goal + out-of-bounds detection. Runs after ball integration. */
export function checkBall(state: MatchState): void {
  if (state.phase !== 'play' && state.phase !== 'kickoff' && state.phase !== 'restart') return;
  const b = state.ball;
  if (b.heldBy >= 0) return;
  const mode = MODES[state.config.mode];
  const halfW = mode.pitchW / 2;
  const halfH = mode.pitchH / 2;

  // goal line crossed
  if (Math.abs(b.x) > halfW + 0.12) {
    const side = Math.sign(b.x);
    // the team attacking toward +x has attackDir === +1; that side's goal is +x
    const scoring: TeamSide = state.attackDir[0] === side ? 0 : 1;
    const defending: TeamSide = scoring === 0 ? 1 : 0;
    if (Math.abs(b.y) < mode.goalW / 2 && b.z < mode.goalH) {
      // GOAL
      state.score[scoring]++;
      const pp = state.pendingPass;
      if (pp && pp.isShot && pp.team === scoring) state.stats[scoring].shotsOnTarget++;
      state.stats[0].streak = 0;
      state.stats[1].streak = 0;
      state.phase = 'goal';
      state.phaseTimer = GOAL_BANNER;
      state.kickoffNext = defending;
      state.live = false;
      state.pendingPass = null;
      state.offsideTeam = -1;
      state.offsideFlags = [];
      state.message = 'GOAL!';
      state.messageTimer = GOAL_BANNER;
      return;
    }
    if (b.lastTouchTeam === defending) {
      // corner for the attacking team
      const ySign = Math.sign(b.y) || 1;
      setRestart(state, 'corner', scoring, side * (halfW - 0.6), ySign * (halfH - 0.6), 'CORNER');
    } else {
      const deep = mode.box6D ?? 4;
      setRestart(state, 'goalkick', defending, side * (halfW - deep), 0, 'GOAL KICK');
    }
    return;
  }

  // touchline crossed -> kick-in (placed with extra margin so takers don't instantly knock it out)
  if (Math.abs(b.y) > halfH + 0.12) {
    const last = b.lastTouchTeam;
    const to: TeamSide = last === 0 ? 1 : 0;
    setRestart(state, 'kickin', to, clamp(b.x, -halfW + 2, halfW - 2), Math.sign(b.y) * (halfH - 1.3), 'KICK-IN');
  }
}

/** Place the ball for a restart and freeze briefly. */
export function setRestart(
  state: MatchState, kind: RestartKind, team: TeamSide, x: number, y: number, message = '',
): void {
  const b = state.ball;
  b.x = x; b.y = y; b.z = 0;
  b.vx = 0; b.vy = 0; b.vz = 0;
  b.heldBy = -1; b.heldTimer = 0;
  b.lastTouchTeam = team;
  b.lastTouchPlayer = -1;

  // taker: GK takes goal kicks when the mode has one, else nearest outfielder
  let taker: PlayerState | null = null;
  let bestD = Infinity;
  const wantGK = kind === 'goalkick';
  for (const p of state.players) {
    if (p.team !== team) continue;
    if (wantGK ? !p.isGK : p.isGK) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; taker = p; }
  }
  if (!taker && wantGK) {
    // no GK in this mode (2v2): nearest outfielder takes it
    for (const p of state.players) {
      if (p.team !== team || p.isGK) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; taker = p; }
    }
  }
  if (taker) taker.decCd = kind === 'kickoff' ? 1.0 : 0.9;

  state.restart = { kind, team, x, y, taker: taker ? taker.id : -1 };
  state.phase = kind === 'kickoff' ? 'kickoff' : 'restart';
  state.phaseTimer = RESTART_FREEZE;
  state.live = false;
  state.pendingPass = null;
  state.offsideTeam = -1;
  state.offsideFlags = [];
  state.queued = null;
  if (message) {
    state.message = message;
    state.messageTimer = 1.4;
  }
  if (team === 0 && taker) state.controlled = taker.id;
}

/** Clock, possession ticks, phase transitions (half/full time, goal banner). */
export function clock(state: MatchState, dt: number): void {
  if (state.messageTimer > 0) state.messageTimer -= dt;

  if (state.phase === 'goal') {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      setupKickoff(state, state.kickoffNext);
      state.message = 'KICK-OFF';
      state.messageTimer = 1.1;
    }
    return;
  }
  if (state.phase === 'halftime') {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      swapSides(state);
      state.half = 2;
      state.time = 0;
      setupKickoff(state, 1);
      state.message = 'KICK-OFF';
      state.messageTimer = 1.1;
    }
    return;
  }
  if (state.phase === 'fulltime') return;

  // running clock (phaseTimer doubles as the restart-grace countdown and may go negative)
  state.phaseTimer -= dt;
  state.time += dt;
  const poss = possessionTeam(state);
  if (poss >= 0) state.possession[poss]++;

  if (state.time >= state.config.halfSeconds && state.phase === 'play') {
    state.live = false;
    if (state.half === 1) {
      state.phase = 'halftime';
      state.phaseTimer = HALF_BANNER;
      state.message = 'HALF-TIME';
      state.messageTimer = HALF_BANNER;
    } else {
      state.phase = 'fulltime';
      state.finished = true;
      state.message = 'FULL-TIME';
      state.messageTimer = 3;
    }
  }
}

/** Push opponents away from a restart spot (called from AI). */
export function restartClearRadius(): number {
  return OPP_CLEAR_R;
}
