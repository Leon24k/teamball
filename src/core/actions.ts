// Kicks and user actions: passing (short/through/lob), shooting, tackling, switching.

import type { MatchState, PlayerState, QueuedActionType } from './types';
import {
  GRAVITY, LUNGE_TIME, PASS_BASE_V, PASS_DIST_V, PASS_MAX_V,
  PASS_MIN_V, PASS_POWER_V, SHOOT_MAX_V, SHOOT_MIN_V, SHOOT_POWER_V,
  THROUGH_MAX_V, THROUGH_MIN_V, MODES, CONTROL_R,
} from './constants';
import { clamp, dist, norm, distToSegment } from './math';
import { rndNoise } from './rng';
import { recordOffside } from './rules';

export type KickKind = 'pass' | 'through' | 'lob' | 'shoot' | 'clear';

/** Lowest-level kick: ball leaves the player. */
export function kickBall(
  state: MatchState, p: PlayerState,
  dirX: number, dirY: number, speed: number, vz: number,
  kind: KickKind, noiseRad = 0,
): void {
  if (noiseRad > 0) {
    const a = Math.atan2(dirY, dirX) + rndNoise(state, noiseRad);
    dirX = Math.cos(a); dirY = Math.sin(a);
  }
  const n = norm(dirX, dirY);
  if (n.len < 1e-4) { dirX = Math.cos(p.facing); dirY = Math.sin(p.facing); }
  else { dirX = n.x; dirY = n.y; }
  const b = state.ball;
  // safety: kicks from right on a touchline bend inward so noise can't Gift an instant throw-in
  const m = MODES[state.config.mode];
  if (Math.abs(b.y) > m.pitchH / 2 - 1.5 && Math.sign(dirY) === Math.sign(b.y)) {
    const bent = norm(dirX, dirY - Math.sign(b.y) * 0.8);
    dirX = bent.x; dirY = bent.y;
  }
  b.x = p.x + dirX * 0.55;
  b.y = p.y + dirY * 0.55;
  b.z = 0;
  b.vx = dirX * speed;
  b.vy = dirY * speed;
  b.vz = vz;
  b.heldBy = -1;
  b.lastTouchPlayer = p.id;
  b.lastTouchTeam = p.team;
  p.touchCd = 0.34;
  if (kind === 'shoot') {
    state.stats[p.team].shots++;
    state.pendingPass = { team: p.team, passer: p.id, isShot: true };
  } else if (kind === 'clear') {
    state.pendingPass = null;
  } else {
    state.stats[p.team].passes++;
    state.pendingPass = { team: p.team, passer: p.id };
    recordOffside(state, p);
  }
}

/** Openness of a position: distance to nearest opponent (capped, mode-scaled). */
export function openness(state: MatchState, x: number, y: number, team: number): number {
  const cap = state.config.mode === '11v11' ? 8 : state.config.mode === '5v5' ? 5.5 : 4;
  let best = cap;
  for (const q of state.players) {
    if (q.team === team || q.isGK) continue;
    const d = dist(x, y, q.x, q.y);
    if (d < best) best = d;
  }
  return best;
}

/** Is the passing lane p->target blocked by an opponent? (0 = open, 1 = blocked) */
export function laneBlocked(state: MatchState, p: PlayerState, tx: number, ty: number): number {
  for (const q of state.players) {
    if (q.team === p.team || q.isGK) continue;
    if (distToSegment(q.x, q.y, p.x, p.y, tx, ty) < 1.1) return 1;
  }
  return 0;
}

/** Pick best pass target inside the aim cone (PES-style assisted passing). */
export function pickPassTarget(
  state: MatchState, p: PlayerState, aimX: number, aimY: number,
): PlayerState | null {
  const aim = norm(aimX, aimY);
  if (aim.len < 0.25) {
    aimX = Math.cos(p.facing); aimY = Math.sin(p.facing);
  } else { aimX = aim.x; aimY = aim.y; }
  let best: PlayerState | null = null;
  let bestScore = -Infinity;
  for (const m of state.players) {
    if (m.team !== p.team || m.id === p.id) continue;
    const d = dist(p.x, p.y, m.x, m.y);
    if (d < 1.5) continue;
    const to = norm(m.x - p.x, m.y - p.y);
    const cos = to.x * aimX + to.y * aimY;
    if (cos < -0.05) continue; // way off the aim cone
    const open = openness(state, m.x, m.y, p.team);
    const prog = (m.x - p.x) * state.attackDir[p.team] * 0.02;
    const gkPen = m.isGK ? -1.2 : 0;
    const distPen = d > 38 ? -0.8 : 0;
    const score = cos * 2.2 + open * 0.09 + prog + gkPen + distPen;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

/** Pass to a specific teammate with lead on their run. */
export function passTo(
  state: MatchState, p: PlayerState, m: PlayerState, power: number, noiseRad = 0,
): void {
  const mode = MODES[state.config.mode];
  const d = dist(p.x, p.y, m.x, m.y);
  let speed = PASS_BASE_V + d * PASS_DIST_V + power * PASS_POWER_V;
  speed = clamp(speed, PASS_MIN_V, PASS_MAX_V);
  const t = d / speed;
  const leadX = clamp(m.x + m.vx * t * 0.8, -mode.pitchW / 2 + 0.8, mode.pitchW / 2 - 0.8);
  const leadY = clamp(m.y + m.vy * t * 0.8, -mode.pitchH / 2 + 0.8, mode.pitchH / 2 - 0.8);
  kickBall(state, p, leadX - p.x, leadY - p.y, speed, 0, 'pass', noiseRad);
}

/** User-facing short pass: aim cone selection then passTo. */
export function executePass(state: MatchState, p: PlayerState, power: number, aimX: number, aimY: number): void {
  const m = pickPassTarget(state, p, aimX, aimY);
  if (m) { passTo(state, p, m, power); return; }
  // no target in cone: safety outlet kick
  const a = norm(aimX, aimY);
  const dx = a.len > 0.25 ? a.x : Math.cos(p.facing);
  const dy = a.len > 0.25 ? a.y : Math.sin(p.facing);
  kickBall(state, p, dx, dy, 10 + power * 8, 0, 'pass');
}

/** Through ball: weight the most advanced open runner, play into space ahead of them. */
export function executeThrough(
  state: MatchState, p: PlayerState, power: number, aimX: number, aimY: number, forced?: PlayerState, noiseRad = 0,
): void {
  const att = state.attackDir[p.team];
  let m = forced;
  if (!m) {
    let bestScore = -Infinity;
    for (const q of state.players) {
      if (q.team !== p.team || q.id === p.id || q.isGK) continue;
      const ahead = (q.x - p.x) * att;
      if (ahead < 2) continue;
      const point = { x: q.x + att * 7, y: q.y };
      const open = openness(state, point.x, point.y, p.team);
      const score = ahead * 0.09 + open * 0.12;
      if (score > bestScore) { bestScore = score; m = q; }
    }
  }
  if (!m) { executePass(state, p, power, aimX, aimY); return; }
  const mode = MODES[state.config.mode];
  const lead = 4 + power * 9;
  const tx = clamp(m.x + att * lead + m.vx * 0.45, -mode.pitchW / 2 + 0.8, mode.pitchW / 2 - 0.8);
  const ty = clamp(m.y * 0.92 + m.vy * 0.45, -mode.pitchH / 2 + 0.8, mode.pitchH / 2 - 0.8);
  const d = dist(p.x, p.y, tx, ty);
  const speed = clamp(d * 1.25, THROUGH_MIN_V, THROUGH_MAX_V);
  kickBall(state, p, tx - p.x, ty - p.y, speed, 0, 'through', noiseRad);
}

/** Lob / long ball / cross: parabola to a far target. */
export function executeLob(
  state: MatchState, p: PlayerState, power: number, aimX: number, aimY: number, forced?: PlayerState, noiseRad = 0,
): void {
  const att = state.attackDir[p.team];
  let m = forced;
  let tx = 0, ty = 0;
  if (!m) {
    const aim = norm(aimX, aimY);
    let bestScore = -Infinity;
    for (const q of state.players) {
      if (q.team !== p.team || q.id === p.id) continue;
      const d = dist(p.x, p.y, q.x, q.y);
      if (d < 9) continue;
      const to = norm(q.x - p.x, q.y - p.y);
      const cos = aim.len > 0.25 ? to.x * aim.x + to.y * aim.y : 0;
      const open = openness(state, q.x, q.y, p.team);
      const score = cos * 1.6 + open * 0.1 + (q.isGK ? -2 : 0);
      if (score > bestScore) { bestScore = score; m = q; }
    }
  }
  if (m) {
    const mode = MODES[state.config.mode];
    const t0 = dist(p.x, p.y, m.x, m.y) / 14;
    tx = clamp(m.x + m.vx * t0 * 0.7, -mode.pitchW / 2 + 1, mode.pitchW / 2 - 1);
    ty = clamp(m.y + m.vy * t0 * 0.7, -mode.pitchH / 2 + 1, mode.pitchH / 2 - 1);
  } else {
    const m = MODES[state.config.mode];
    const a = norm(aimX, aimY);
    tx = p.x + (a.len > 0.25 ? a.x : Math.cos(p.facing)) * (14 + power * 14);
    ty = p.y + (a.len > 0.25 ? a.y : Math.sin(p.facing)) * (14 + power * 14);
    // bias lobs down the field, but keep the target inside the pitch
    tx = clamp(tx + att * 6, -m.pitchW / 2 + 1, m.pitchW / 2 - 1);
    ty = clamp(ty, -m.pitchH / 2 + 1, m.pitchH / 2 - 1);
  }
  const d = Math.max(6, dist(p.x, p.y, tx, ty));
  const t = clamp(0.75 + d * 0.022, 0.8, 1.75);
  const vz = (GRAVITY * t) / 2;
  const vh = d / t;
  kickBall(state, p, tx - p.x, ty - p.y, vh, vz, 'lob', noiseRad);
}

/** Shot. aimY (-1..1) steers across the goal mouth. */
export function executeShoot(
  state: MatchState, p: PlayerState, power: number, aimY: number, noiseRad = 0,
): void {
  const mode = MODES[state.config.mode];
  const att = state.attackDir[p.team];
  const gx = att * (mode.pitchW / 2);
  const targetY = clamp(aimY, -1, 1) * (mode.goalW / 2 - 0.35);
  const dGoal = dist(p.x, p.y, gx, 0);
  // pressure & distance hurt accuracy
  let pressure = 0;
  for (const q of state.players) {
    if (q.team !== p.team && dist(q.x, q.y, p.x, p.y) < 2.2) pressure += 0.5;
  }
  const err = 0.02 + power * 0.045 + pressure * 0.05 + Math.max(0, dGoal - 18) * 0.004;
  const speed = clamp(SHOOT_MIN_V + power * SHOOT_POWER_V, SHOOT_MIN_V, SHOOT_MAX_V);
  const vz = 0.7 + power * 2.4 + Math.max(0, dGoal - 20) * 0.09;
  kickBall(state, p, gx - p.x, targetY - p.y, speed, vz, 'shoot', err + noiseRad);
}

/** Manual switch: cycle to teammate nearest the ball. */
export function trySwitch(state: MatchState): void {
  const cur = state.players[state.controlled];
  const b = state.ball;
  let best: PlayerState | null = null;
  let bestScore = -Infinity;
  for (const q of state.players) {
    if (q.team !== 0 || q.isGK || q.id === state.controlled) continue;
    const score = -dist(q.x, q.y, b.x, b.y) + (cur && q.id === cur.id ? 5 : 0);
    if (score > bestScore) { bestScore = score; best = q; }
  }
  if (best) {
    state.controlled = best.id;
    state.switchCd = 0.4;
  }
}

/** Start a tackle lunge toward the ball (risk/reward: whiff = brief stun). */
export function startTackle(state: MatchState, p: PlayerState): void {
  if (p.lunge > 0 || p.stun > 0) return;
  const b = state.ball;
  if (dist(p.x, p.y, b.x, b.y) > 4.5) return;
  p.facing = Math.atan2(b.y - p.y, b.x - p.x);
  p.aiDir = p.facing;
  p.lunge = LUNGE_TIME;
}

/** Can this player legally kick the ball right now? */
export function canKick(state: MatchState, p: PlayerState): boolean {
  const b = state.ball;
  if (b.heldBy >= 0) return b.heldBy === p.id;
  return dist(p.x, p.y, b.x, b.y) < CONTROL_R + 0.25;
}

/** Buffer an action for a short window until the player gains control. */
export function queueAction(state: MatchState, type: QueuedActionType, power: number): void {
  state.queued = { type, power, life: 0.6 };
}
