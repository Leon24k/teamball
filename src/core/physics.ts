// Player & ball integration, collisions, and ball-player interaction (the "feel" layer).

import type { MatchState, PlayerState } from './types';
import {
  ACCEL, AIR_DECAY, BALL_R, BOUNCE_DRAG, CONTROL_R, GRAVITY, GROUND_REST,
  LUNGE_SPEED, PLAYER_R, ROLL_DECAY, TOUCH_CD, TOUCH_HOLD, JOG_SPEED, MODES,
} from './constants';
import { clamp, norm, turnToward } from './math';
import { onBallTouched } from './rules';
import { rnd } from './rng';

export function stepPlayers(state: MatchState, dt: number): void {
  const mode = MODES[state.config.mode];
  const boundX = mode.pitchW / 2 + 1.5;
  const boundY = mode.pitchH / 2 + 1.5;
  for (const p of state.players) {
    if (p.lunge > 0) {
      p.dvx = Math.cos(p.facing) * LUNGE_SPEED;
      p.dvy = Math.sin(p.facing) * LUNGE_SPEED;
    } else if (p.stun > 0) {
      p.dvx = 0; p.dvy = 0;
    }
    // accelerate toward desired velocity
    const dvx = p.dvx - p.vx, dvy = p.dvy - p.vy;
    const dl = Math.hypot(dvx, dvy);
    const max = ACCEL * dt;
    if (dl > max) { p.vx += (dvx / dl) * max; p.vy += (dvy / dl) * max; }
    else { p.vx = dvx; p.vy = dvy; }
    p.x = clamp(p.x + p.vx * dt, -boundX, boundX);
    p.y = clamp(p.y + p.vy * dt, -boundY, boundY);
    // face where we're heading
    if (Math.hypot(p.vx, p.vy) > 0.6) {
      p.facing = turnToward(p.facing, Math.atan2(p.vy, p.vx), 12 * dt);
    }
  }
  separatePlayers(state);
}

function separatePlayers(state: MatchState): void {
  const ps = state.players;
  const minD = PLAYER_R * 2;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const push = (minD - d) * 0.5;
      const nx = dx / d, ny = dy / d;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
    }
  }
}

export function stepBall(state: MatchState, dt: number): void {
  const b = state.ball;
  if (b.heldBy >= 0) return; // glued to GK (position handled in ai)
  // vertical
  if (b.z > 0 || b.vz > 0) {
    b.vz -= GRAVITY * dt;
    b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -1.2) {
        b.vz = -b.vz * GROUND_REST;
        b.vx *= BOUNCE_DRAG;
        b.vy *= BOUNCE_DRAG;
      } else {
        b.vz = 0;
      }
    }
  }
  // rolling / air friction
  const decay = b.z > 0.05 ? AIR_DECAY : ROLL_DECAY;
  const f = Math.exp(-decay * dt);
  b.vx *= f; b.vy *= f;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

/** Distance from ball to a player. */
export function ballDist(p: PlayerState, state: MatchState): number {
  return Math.hypot(state.ball.x - p.x, state.ball.y - p.y);
}

/** Player currently in control (touching) the ball, or null. */
export function ballController(state: MatchState): PlayerState | null {
  const b = state.ball;
  if (b.heldBy >= 0) return state.players[b.heldBy] ?? null;
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.touchCd > 0) continue;
    const d = ballDist(p, state);
    if (d < CONTROL_R && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Team currently regarded as in possession (for AI phase + possession stats). */
export function possessionTeam(state: MatchState): number {
  const c = ballController(state);
  if (c) return c.team;
  return state.ball.lastTouchTeam >= 0 ? state.ball.lastTouchTeam : -1;
}

/**
 * Ball-player interaction. Runs after integration.
 * One player touches per tick (nearest eligible).
 */
export function ballInteract(state: MatchState): void {
  const b = state.ball;
  if (b.heldBy >= 0) return;
  if (b.z > 1.6) return; // over heads

  // pick nearest eligible toucher
  let cand: PlayerState | null = null;
  let candD = Infinity;
  // while the ball is placed & static only the taker may touch, and only if
  // human-controlled (AI takers play their restart kick through actions)
  const ballStatic = Math.hypot(state.ball.vx, state.ball.vy) < 0.5 && state.ball.z < 0.05;
  const deadBall = !state.live && state.restart !== null && ballStatic;
  for (const p of state.players) {
    if (p.touchCd > 0 || p.stun > 0) continue;
    if (deadBall) {
      if (!state.restart || p.id !== state.restart.taker) continue;
      if (p.id !== state.controlled) continue;
    }
    const d = ballDist(p, state);
    const reach = p.lunge > 0 ? CONTROL_R + 0.45 : CONTROL_R;
    if (d < reach && d < candD) { cand = p; candD = d; }
  }
  if (!cand) return;
  const p = cand;

  const speed = Math.hypot(b.vx, b.vy);

  // GK catch: shots / high balls in own box
  if (p.isGK && (speed > 8 || b.z > 0.6) && candD < 1.25 && b.z < 2.2 && inOwnBox(state, p)) {
    b.heldBy = p.id;
    b.heldTimer = TOUCH_HOLD;
    b.vx = 0; b.vy = 0; b.vz = 0; b.z = 0.9;
    b.lastTouchPlayer = p.id;
    b.lastTouchTeam = p.team;
    onBallTouched(state, p);
    return;
  }

  // tackle lunge reaching the ball = clearance / dispossession
  if (p.lunge > 0) {
    const fx = Math.cos(p.facing), fy = Math.sin(p.facing);
    const away = norm(b.x - p.x, b.y - p.y);
    const mix = norm(away.x * 0.5 + fx * 0.5, away.y * 0.5 + fy * 0.5);
    b.vx = mix.x * 8.5;
    b.vy = mix.y * 8.5;
    b.vz = 1.5;
    b.z = Math.max(b.z, 0.01);
    b.lastTouchPlayer = p.id;
    b.lastTouchTeam = p.team;
    p.touchCd = 0.45;
    p.lunge = 0; // won the ball: no whiff stun
    onBallTouched(state, p);
    return;
  }

  const desired = norm(p.dvx, p.dvy);
  const moveDir = desired.len > 0.3 ? desired : { x: Math.cos(p.facing), y: Math.sin(p.facing), len: 1 };
  const moving = Math.hypot(p.vx, p.vy);

  // the human player charging a kick traps the ball at their feet (PES-style
  // wind-up) instead of dribble-pushing it away mid-charge
  const charging = p.id === state.controlled
    && (state.inputs.pass || state.inputs.through || state.inputs.lob || state.inputs.shoot);

  if (speed < 9.5 && charging) {
    b.vx = p.vx;
    b.vy = p.vy;
    b.vz = 0;
    b.z = 0;
    b.x = p.x + moveDir.x * 0.5;
    b.y = p.y + moveDir.y * 0.5;
  } else if (speed < 9.5) {
    // dribble touch: keep the ball close to the feet (PES-style tight dribbling)
    const sprinting = desired.len > 0.3 && Math.hypot(p.dvx, p.dvy) > JOG_SPEED + 0.5;
    const push = moving * 0.95 + 1.1 + (sprinting ? 1.5 : 0);
    b.vx = moveDir.x * push;
    b.vy = moveDir.y * push;
    b.vz = 0;
    b.z = 0;
    b.x = p.x + moveDir.x * 0.55;
    b.y = p.y + moveDir.y * 0.55;
  } else {
    // first touch / interception: kill momentum into the run direction.
    // Faster ball = wobblier control (bad touches happen naturally).
    const settleCap = state.config.mode === '11v11' ? 5 : 3.6;
    const settle = clamp(speed * 0.22, 2.2, settleCap);
    const wob = (speed - 9.5) * 0.06;
    const w1 = (rnd(state) - 0.5) * 2 * wob;
    const w2 = (rnd(state) - 0.5) * 2 * wob;
    // AI players take their first touch facing the opponent goal
    let ftx = moveDir.x, fty = moveDir.y;
    if (p.id !== state.controlled) {
      const att = state.attackDir[p.team];
      const fwd = norm(ftx + att * 0.55, fty * 0.85);
      if (fwd.len > 0.01) { ftx = fwd.x; fty = fwd.y; }
    }
    b.vx = ftx * settle + Math.cos(p.facing + 1.57) * w1;
    b.vy = fty * settle + Math.sin(p.facing + 1.57) * w2;
    b.vz = 0;
    b.z = 0;
    b.x = p.x + ftx * 0.45;
    b.y = p.y + fty * 0.45;
  }
  b.lastTouchPlayer = p.id;
  b.lastTouchTeam = p.team;
  p.touchCd = TOUCH_CD;
  onBallTouched(state, p);
}

export function inOwnBox(state: MatchState, p: PlayerState): boolean {
  const mode = MODES[state.config.mode];
  const boxD = mode.boxD ?? 2.5;
  const boxW = mode.boxW ?? 8;
  const ownGoalX = -state.attackDir[p.team] * (mode.pitchW / 2);
  const b = state.ball;
  return Math.abs(b.x - ownGoalX) <= boxD + 1.5 && Math.abs(b.y) < boxW / 2 + 1;
}

export { BALL_R };
