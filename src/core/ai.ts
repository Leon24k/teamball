// Team AI: elastic formation anchors, pressing, on-ball decisions, goalkeeper.

import type { MatchState, PlayerState } from './types';
import {
  AI_SETTINGS, ATTACK_PUSH, COMPRESS_Y, DEFEND_DROP, GK_BOX, GK_DIVE_RANGE,
  GK_SPEED, GRAVITY, JOG_SPEED, MODES, PRESS_COUNT, SPRINT_SPEED, STRETCH_X,
  STRETCH_Y,
} from './constants';
import { clamp, dist, norm } from './math';
import { rnd, rndRange } from './rng';
import {
  ballController, ballDist, possessionTeam,
} from './physics';
import {
  executeLob, executePass, executeShoot, executeThrough, kickBall, laneBlocked,
  openness, passTo, pickPassTarget, startTackle,
} from './actions';
import { restartClearRadius } from './rules';

const FROZEN = new Set(['goal', 'halftime', 'fulltime']);

export function computeAI(state: MatchState, dt: number): void {
  const mode = MODES[state.config.mode];
  const cfg = AI_SETTINGS[state.config.difficulty];
  const poss = possessionTeam(state);
  const ctrl = ballController(state);
  const b = state.ball;
  const frozen = FROZEN.has(state.phase);
  const scale = mode.pitchW / 105;

  // "dead" = ball placed & static (waiting for the restart kick).
  // once the taker has played it, everyone returns to normal live logic.
  const ballMoving = Math.hypot(b.vx, b.vy) > 0.5 || b.z > 0.05;
  const dead = !state.live && state.restart !== null && !ballMoving;

  // the carrier is whoever last touched the ball and is still near it.
  // (a strict "ball underfoot" check flickers off during dribble touch
  // cooldowns, which used to starve the AI of decision windows entirely)
  const toucher = b.lastTouchPlayer >= 0 ? state.players[b.lastTouchPlayer] : undefined;
  const carrier = toucher && !toucher.isGK && b.heldBy < 0
    && Math.hypot(toucher.x - b.x, toucher.y - b.y) < 3.2 ? toucher : null;

  // a human restart taker who isn't touching their controls gets AI-walked to
  // the ball (and after a grace period the AI plays the kick for them too)
  const idleInput = Math.hypot(state.inputs.mx, state.inputs.my) < 0.15
    && !state.inputs.sprint && !state.inputs.pass && !state.inputs.through
    && !state.inputs.lob && !state.inputs.shoot && !state.inputs.tackle;

  // pressers = N nearest non-GK players of each out-of-possession team
  const pressHome = !frozen && !dead && poss !== 0 ? pickPressers(state, 0) : [];
  const pressAway = !frozen && !dead && poss !== 1 ? pickPressers(state, 1) : [];

  // when nobody controls the ball, each team's nearest non-GK player chases it
  // (covers chasing your own dribble touch and running onto passes)
  const chaserFor: [number, number] = [-1, -1];
  if (!ctrl && !dead) {
    for (const team of [0, 1] as const) {
      let bd = Infinity;
      for (const q of state.players) {
        if (q.team !== team || q.isGK) continue;
        const d = ballDist(q, state);
        if (d < bd) { bd = d; chaserFor[team] = q.id; }
      }
    }
  }

  // attacking shape: the carrier's nearest two teammates offer passing lanes,
  // and the two most advanced outfielders make runs on the last defensive line
  const supportFor = new Set<number>();
  const runFor = new Set<number>();
  if (!frozen && !dead && carrier) {
    const mates = state.players
      .filter((q) => q.team === carrier.team && !q.isGK && q.id !== carrier.id);
    const byNear = [...mates].sort((a, b2) =>
      dist(a.x, a.y, carrier.x, carrier.y) - dist(b2.x, b2.y, carrier.x, carrier.y));
    for (const m of byNear.slice(0, 2)) supportFor.add(m.id);
    const byAdv = [...mates].sort((a, b2) =>
      b2.x * state.attackDir[b2.team] - a.x * state.attackDir[a.team]);
    for (const m of byAdv.slice(0, 2)) runFor.add(m.id);
  }

  for (const p of state.players) {
    // user-controlled player is handled in step(), except an idle restart taker
    const userTakerDead = dead && state.restart !== null && state.restart.taker === p.id;
    if (p.id === state.controlled && p.team === 0 && !(userTakerDead && idleInput)) continue;

    // decision cadence: tick continuously; reset when this player just won the ball
    if (b.lastTouchPlayer === p.id && state.prevTouchPlayer !== p.id && !p.isGK) {
      p.decCd = cfg.reaction * rndRange(state, 1.4, 2.4);
    }
    p.decCd -= dt;

    if (frozen) { p.dvx = 0; p.dvy = 0; continue; }
    if (p.stun > 0) { p.dvx = 0; p.dvy = 0; continue; }

    // restart taker first (includes GK taking goal kicks)
    if (dead && state.restart && state.restart.taker === p.id) {
      restartAI(state, p, dt, cfg);
      continue;
    }

    if (p.isGK) { gkAI(state, p, dt, cfg); continue; }

    const att = state.attackDir[p.team];
    const attacking = poss === p.team;
    const defending = poss >= 0 && poss !== p.team;

    // ---- dead-ball phases ----
    if (dead && state.restart) {
      restartAI(state, p, dt, cfg);
      continue;
    }

    // ---- carrier ----
    if (carrier && carrier.id === p.id) {
      carrierAI(state, p, cfg);
      continue;
    }

    // ---- pressing (chase the ball / cover the goal-side lane) ----
    if (poss !== p.team && (p.team === 0 ? pressHome : pressAway).includes(p)) {
      const idx = (p.team === 0 ? pressHome : pressAway).indexOf(p);
      const goalX = -att * (mode.pitchW / 2);
      if (idx === 0) {
        const lead = 0.28;
        moveTo(state, p, b.x + b.vx * lead, b.y + b.vy * lead, SPRINT_SPEED * cfg.press, cfg);
        // attempt dispossession (paced, so play doesn't collapse into a scrum)
        const possessor = ctrl;
        if (possessor && possessor.team !== p.team && ballDist(p, state) < 1.7 && rnd(state) < dt * 0.5) {
          startTackle(state, p);
        }
      } else {
        // second presser: cut the line between the ball and our goal
        const cover = norm(goalX - b.x, -b.y);
        moveTo(state, p, b.x + cover.x * 5, b.y + cover.y * 5, SPRINT_SPEED * cfg.press * 0.95, cfg);
      }
      continue;
    }

    // ---- chase our own ball (dribble touch / pass reception) ----
    if (attacking && !ctrl && chaserFor[p.team] === p.id && ballDist(p, state) < 14) {
      moveTo(state, p, b.x + b.vx * 0.2, b.y + b.vy * 0.2, SPRINT_SPEED * 0.98, cfg);
      continue;
    }

    // ---- off-ball positioning: elastic formation anchors ----
    let tx = p.ax + b.x * STRETCH_X;
    let ty = p.ay + (b.y - p.ay) * STRETCH_Y * 0.5;
    if (attacking) {
      tx += att * ATTACK_PUSH * scale;
      ty = p.ay * 1.06 + (b.y - p.ay * 1.06) * 0.2;
      if (carrier && supportFor.has(p.id)) {
        // offer a passing lane around the carrier: best of three open spots
        const lanes = [
          [carrier.x - att * 6, carrier.y - 6],
          [carrier.x - att * 6, carrier.y + 6],
          [carrier.x + att * 9, carrier.y + (p.y > carrier.y ? 7 : -7)],
        ];
        let bestOpen = -1;
        for (const [lx, ly] of lanes) {
          const cx = clamp(lx, -mode.pitchW / 2 + 1, mode.pitchW / 2 - 1);
          const cy = clamp(ly, -mode.pitchH / 2 + 1, mode.pitchH / 2 - 1);
          const o = openness(state, cx, cy, p.team);
          if (o > bestOpen) {
            bestOpen = o;
            tx = tx * 0.3 + cx * 0.7;
            ty = ty * 0.3 + cy * 0.7;
          }
        }
      }
      if (carrier && runFor.has(p.id) && (p.role === 'FW' || p.role === 'MF')) {
        // run in behind: hover on the last line when offside is on,
        // otherwise a bounded push ahead of the anchor
        const anchorM = tx * att;
        let targetM: number;
        if (state.config.offside && mode.offside) {
          targetM = offsideLimitMetric(state, p.team);
        } else {
          targetM = Math.min(anchorM + 10 * scale, mode.pitchW / 2 - 4);
        }
        tx = targetM * att;
      }
    } else if (defending) {
      tx -= att * DEFEND_DROP * scale;
      ty = p.ay + (b.y * 0.6 - p.ay) * COMPRESS_Y * 0.5;
      // full-backs pick up nearby runners
      if (p.role === 'FB') {
        const mark = nearestOpponent(state, p, 9);
        if (mark && mark.x * att < p.x * att + 6) {
          tx = tx * 0.55 + (mark.x - att * 1.2) * 0.45;
          ty = ty * 0.55 + mark.y * 0.45;
        }
      }
      // cover the goal when the ball enters our defensive third
      const goalX = -att * (mode.pitchW / 2);
      const dBG = dist(b.x, b.y, goalX, 0);
      if (p.role !== 'FW' && dBG < 26) {
        const cover = norm(goalX - b.x, -b.y);
        const tight = state.config.mode === '2v2' ? 0.3 : 0.45;
        const off = clamp(dBG * tight, 1.5, 9);
        tx = tx * 0.35 + (b.x + cover.x * off) * 0.65;
        ty = ty * 0.35 + (b.y + cover.y * off) * 0.65;
      }
    } else {
      // loose ball: nearest one or two of each team also contest
      const d = ballDist(p, state);
      if (d < 14) { tx = tx * 0.4 + b.x * 0.6; ty = ty * 0.4 + b.y * 0.6; }
    }
    tx = clamp(tx, -mode.pitchW / 2 + 1, mode.pitchW / 2 - 1);
    ty = clamp(ty, -mode.pitchH / 2 + 1, mode.pitchH / 2 - 1);
    const chase = dist(p.x, p.y, tx, ty);
    moveTo(state, p, tx, ty, chase > 10 ? SPRINT_SPEED * 0.96 : JOG_SPEED, cfg);
  }
}

function pickPressers(state: MatchState, team: number): PlayerState[] {
  const n = PRESS_COUNT[state.config.mode];
  const cands = state.players
    .filter((p) => p.team === team && !p.isGK && !(p.id === state.controlled && team === 0) && p.stun <= 0)
    .sort((a, b2) => ballDist(a, state) - ballDist(b2, state));
  return cands.slice(0, n);
}

/**
 * The furthest "safe" depth (in attack-direction metric space, x*att) an
 * attacker may stand without being offside. Never inside their own half.
 */
export function offsideLimitMetric(state: MatchState, team: number): number {
  const mode = MODES[state.config.mode];
  const att = state.attackDir[team];
  const edge = mode.pitchW / 2 - 2;
  if (!state.config.offside || !mode.offside) return edge;
  const def = team === 0 ? 1 : 0;
  const metrics = state.players
    .filter((p) => p.team === def)
    .map((p) => p.x * att)
    .sort((a, b) => b - a);
  const secondLast = metrics[1] ?? metrics[0] ?? 0;
  return Math.max(0, Math.min(edge, secondLast - 0.8));
}

function nearestOpponent(state: MatchState, p: PlayerState, maxD: number): PlayerState | null {
  let best: PlayerState | null = null;
  let bd = maxD;
  for (const q of state.players) {
    if (q.team === p.team || q.isGK) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/** Move toward a target with arrive behavior; writes desired velocity. */
function moveTo(
  state: MatchState, p: PlayerState, x: number, y: number, topSpeed: number,
  cfg: (typeof AI_SETTINGS)['normal'],
): void {
  const dx = x - p.x, dy = y - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.15) { p.dvx = 0; p.dvy = 0; return; }
  const sp = clamp(d * 2.5, 0.8, topSpeed);
  const n = norm(dx, dy);
  const wob = rnd(state) * cfg.noise * 0.12;
  const ang = Math.atan2(n.y, n.x) + (wob - cfg.noise * 0.06);
  p.dvx = Math.cos(ang) * sp;
  p.dvy = Math.sin(ang) * sp;
}

// ---------------- on-ball AI ----------------

function carrierAI(
  state: MatchState, p: PlayerState,
  cfg: (typeof AI_SETTINGS)['normal'],
): void {
  const mode = MODES[state.config.mode];
  const att = state.attackDir[p.team];
  const gx = att * (mode.pitchW / 2);

  // continuous dribbling between decisions
  const toGoal = norm(gx - p.x, -p.y * 0.3);
  let ax = toGoal.x, ay = toGoal.y;
  let pressure = 0;
  for (const q of state.players) {
    if (q.team === p.team) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < 5.5 && d > 1e-3) {
      const w = (5.5 - d) / 5.5 * 0.9;
      ax -= ((q.x - p.x) / d) * w;
      ay -= ((q.y - p.y) / d) * w;
      if (d < 2.5) pressure += 1 - d / 2.5;
    }
  }
  // stay off the touchlines
  const halfH = mode.pitchH / 2;
  if (Math.abs(p.y) > halfH - 3) ay -= Math.sign(p.y) * 0.5;
  const n = norm(ax, ay);
  const dirA = n.len > 0.01 ? Math.atan2(n.y, n.x) : p.aiDir;
  p.aiDir = dirA;
  const carrierSpeed = JOG_SPEED * 0.94;
  p.dvx = Math.cos(dirA) * carrierSpeed;
  p.dvy = Math.sin(dirA) * carrierSpeed;
  if (p.decCd > 0) return;
  p.decCd = cfg.reaction * rndRange(state, 0.75, 1.35);

  const dGoal = dist(p.x, p.y, gx, 0);
  const shootRange = state.config.mode === '11v11' ? 24 : state.config.mode === '5v5' ? 11 : 8;

  // option: SHOOT (only from real shooting positions: close, or a clear lane)
  let shootScore = -1;
  if (dGoal < shootRange && Math.abs(p.y) < mode.pitchH / 2 - 2) {
    const blocked = laneBlocked(state, p, gx, clamp(p.y * 0.3, -mode.goalW / 2, mode.goalW / 2));
    shootScore = (shootRange - dGoal) * 0.09 + 0.55 - blocked * 1.15;
    if (dGoal < mode.goalW * 1.6) shootScore += 0.6; // sniffing distance: be brave
    if (Math.abs(p.y) > mode.goalW * 1.1 && dGoal > mode.goalW * 2) shootScore -= 0.8; // wide angle
  }

  // option: PASS / THROUGH
  let passScore = -1;
  let passMate: PlayerState | null = null;
  let throughScore = -1;
  let throughMate: PlayerState | null = null;
  const offLimit = offsideLimitMetric(state, p.team);
  const offsideOn = state.config.offside && mode.offside;
  for (const m of state.players) {
    if (m.team !== p.team || m.id === p.id || m.isGK) continue;
    const d = dist(p.x, p.y, m.x, m.y);
    if (d < 3 || d > 38) continue;
    const open = openness(state, m.x, m.y, p.team);
    const blocked = laneBlocked(state, p, m.x, m.y);
    const prog = (m.x - p.x) * att * 0.055;
    let s = open * 0.13 + prog - blocked * 0.7 - (d > 32 ? 0.5 : 0);
    if (offsideOn && m.x * att > offLimit + 0.3) s -= 1.5; // would run into an offside trap
    if (s > passScore) { passScore = s; passMate = m; }
    const ahead = (m.x - p.x) * att;
    if (ahead > 4) {
      const px = m.x + att * 7;
      const sOpen = openness(state, px, m.y, p.team);
      let ts = sOpen * 0.13 + ahead * 0.045;
      if (offsideOn && px * att > offLimit + 1.5) ts -= 1.2; // through into offside space is wasted
      if (ts > throughScore) { throughScore = ts; throughMate = m; }
    }
  }

  // option: DRIBBLE (space ahead)
  const spaceAhead = openness(state, p.x + att * 7, p.y, p.team);
  const dribbleScore = spaceAhead * 0.12 - pressure * 0.6;

  // optional telemetry hook (used by scripts/instrument.ts)
  const dbg = (globalThis as { __TB_DEBUG?: (s: string) => void }).__TB_DEBUG;
  if (dbg) {
    dbg(`decide t=${state.time.toFixed(1)} p${p.num}T${p.team} dGoal=${dGoal.toFixed(0)} ` +
      `shoot=${shootScore.toFixed(2)} pass=${passScore.toFixed(2)} thr=${throughScore.toFixed(2)} ` +
      `drib=${dribbleScore.toFixed(2)} press=${pressure.toFixed(1)}`);
  }

  // forced clearance under heavy pressure in own third
  const ownThird = p.x * att < mode.pitchW * 0.22;
  if (ownThird && pressure > 1.1) {
    kickBall(state, p, att, rndRange(state, -0.5, 0.5), 15, 4.5, 'clear', cfg.passErr);
    return;
  }

  if (shootScore > passScore && shootScore > throughScore && shootScore > dribbleScore) {
    executeShoot(state, p, clamp(dGoal / shootRange, 0.45, 1), rndRange(state, -0.5, 0.5), cfg.passErr * 0.5);
    return;
  }
  // small pitches forgive riskier passing, big pitches demand more patience
  const passTh = state.config.mode === '11v11' ? 0.7 : state.config.mode === '5v5' ? 0.55 : 0.45;
  if (throughScore > passTh + 0.15 && throughScore > passScore && throughScore > dribbleScore && throughMate) {
    executeThrough(state, p, 0.55, 0, 0, throughMate, cfg.passErr);
    return;
  }
  if (passScore > passTh && passScore > dribbleScore && passMate) {
    passTo(state, p, passMate, 0.4, cfg.passErr);
  }
  // else: keep dribbling (handled above)
}

// ---------------- goalkeeper AI ----------------

function gkAI(
  state: MatchState, p: PlayerState, dt: number,
  cfg: (typeof AI_SETTINGS)['normal'],
): void {
  const mode = MODES[state.config.mode];
  const b = state.ball;
  const att = state.attackDir[p.team];
  const gx = -att * (mode.pitchW / 2);
  const goalW = mode.goalW;

  // holding the ball: walk out a bit, then distribute
  if (b.heldBy === p.id) {
    b.x = p.x + Math.cos(p.facing) * 0.45;
    b.y = p.y + Math.sin(p.facing) * 0.45;
    b.z = 0.9;
    moveTo(state, p, gx + att * 4, 0, JOG_SPEED * 0.7, cfg);
    p.facing = att > 0 ? 0 : Math.PI;
    b.heldTimer -= dt;
    if (b.heldTimer <= 0) {
      // distribute to the most open teammate within reach, preferring width upfield
      let best: PlayerState | null = null;
      let bestS = -Infinity;
      for (const m of state.players) {
        if (m.team !== p.team || m.id === p.id) continue;
        const d = dist(p.x, p.y, m.x, m.y);
        if (d < 6 || d > 28) continue;
        const s = openness(state, m.x, m.y, p.team) + (m.x - p.x) * att * 0.04 - d * 0.04;
        if (s > bestS) { bestS = s; best = m; }
      }
      if (best) {
        executeLob(state, p, 0.4, 0, 0, best, cfg.passErr);
      } else {
        // no safe option: shorter release upfield instead of a blind big clear
        kickBall(state, p, att, 0.2, 11, 3.5, 'clear');
      }
    }
    return;
  }

  // base positioning: stand on the ball-to-goal angle, slightly off the line
  const dBG0 = dist(b.x, b.y, gx, 0);
  const out = clamp(0.8 + dBG0 * 0.045, 0.8, 4.2);
  const dirBall = norm(b.x - gx, b.y);
  let tx = gx + dirBall.x * out;
  let ty = clamp(dirBall.y * out * 1.8, -goalW / 2 - 0.2, goalW / 2 - 0.2);
  let sp = GK_SPEED * 0.55;

  // shot incoming: intercept the crossing point
  const towardGoal = (b.vx * att) < -6;
  const dFromGoal = Math.abs(b.x - gx);
  if (towardGoal && dFromGoal < GK_DIVE_RANGE) {
    const lineX = gx + att * 0.6;
    const t = (lineX - b.x) / (b.vx || -1e-6);
    if (t > 0 && t < 2.2) {
      const yCross = b.y + b.vy * t;
      if (Math.abs(yCross) < goalW / 2 + 3) {
        tx = lineX;
        ty = clamp(yCross, -goalW / 2 - 0.4, goalW / 2 + 0.4);
        sp = GK_SPEED;
      }
    }
  }

  // claim slow loose balls in the box
  const ballSlow = Math.hypot(b.vx, b.vy) < 6;
  const inBox = Math.abs(b.x - gx) < GK_BOX * 0.8 && Math.abs(b.y) < (mode.boxW ?? 14) / 2 + 2;
  if (ballSlow && inBox) {
    let oppCloser = false;
    for (const q of state.players) {
      if (q.team === p.team) continue;
      if (dist(q.x, q.y, b.x, b.y) < dist(p.x, p.y, b.x, b.y) - 0.5) { oppCloser = true; break; }
    }
    if (!oppCloser) { tx = b.x; ty = b.y; sp = GK_SPEED * 0.9; }
  }

  // never stray far from goal
  tx = att > 0 ? clamp(tx, gx, gx + 14) : clamp(tx, gx - 14, gx);
  moveTo(state, p, tx, ty, sp, cfg);
}

// ---------------- dead-ball AI ----------------

function restartAI(
  state: MatchState, p: PlayerState, dt: number,
  cfg: (typeof AI_SETTINGS)['normal'],
): void {
  const mode = MODES[state.config.mode];
  const rs = state.restart!;
  const b = state.ball;
  const att = state.attackDir[p.team];

  // the taker walks to the ball and plays it
  if (p.id === rs.taker) {
    const d = ballDist(p, state);
    if (d > 0.9) {
      moveTo(state, p, b.x - att * 0.6, b.y, JOG_SPEED, cfg);
      return;
    }
    p.dvx = 0; p.dvy = 0;
    // the human taker plays it themselves - unless they idled past the grace window
    if (p.team === 0 && state.phaseTimer > -2.5) return;
    p.decCd -= dt;
    if (p.decCd > 0) return;
    p.decCd = 99; // kick once
    switch (rs.kind) {
      case 'corner': {
        const tx = att * (mode.pitchW / 2 - (mode.boxD ? mode.boxD * 0.55 : 4));
        const ty = clamp(-Math.sign(rs.y) * rndRange(state, 1, 4), -8, 8);
        const dd = dist(p.x, p.y, tx, ty);
        const t = clamp(0.9 + dd * 0.02, 0.95, 1.5);
        kickBall(state, p, tx - p.x, ty - p.y, dd / t, (GRAVITY * t) / 2, 'lob', cfg.passErr);
        break;
      }
      case 'goalkick': {
        const m = pickPassTarget(state, p, att * 10, 0);
        if (m && dist(p.x, p.y, m.x, m.y) > 8) executeLob(state, p, 0.5, 0, 0, m, cfg.passErr);
        else kickBall(state, p, att, 0.3, 15, 5, 'clear');
        break;
      }
      default: {
        // kickoff / kick-in / free kick: keep it simple, play to the best option
        const inward = rs.y === 0 ? 0 : -Math.sign(rs.y) * 3;
        const m = pickPassTarget(state, p, att * 5, inward);
        if (m) passTo(state, p, m, 0.4, cfg.passErr);
        else executePass(state, p, 0.4, att, inward);
        break;
      }
    }
    return;
  }

  // everyone else: hold formation, respect the clearance radius
  let tx = p.ax;
  let ty = p.ay;
  if (p.team !== rs.team) {
    // defensive shape while waiting
    tx -= att * 2;
    const clear = restartClearRadius() + 0.5;
    const d = dist(p.x, p.y, rs.x, rs.y);
    if (d < clear) {
      const n = norm(p.x - rs.x, p.y - rs.y);
      if (n.len < 0.01) { n.x = -att; n.y = 0; }
      tx = rs.x + n.x * clear;
      ty = rs.y + n.y * clear;
    }
  } else if (rs.kind === 'corner') {
    // send runners into the box
    const mates = state.players
      .filter((q) => q.team === p.team && !q.isGK && q.id !== rs.taker)
      .sort((a, b2) => (b2.x * att - a.x * att));
    const idx = mates.indexOf(p);
    if (idx >= 0 && idx < 3) {
      tx = att * (mode.pitchW / 2 - (mode.boxD ? mode.boxD * 0.45 : 4));
      ty = (p.num % 2 === 0 ? 1 : -1) * (1.5 + idx * 2.5);
    }
  } else {
    // offer a safe option near the taker
    const d = dist(p.x, p.y, b.x, b.y);
    if (d < 16 && p.role !== 'GK') {
      tx = p.ax * 0.5 + b.x * 0.5 + att * 2;
      ty = p.ay * 0.5 + b.y * 0.5;
    }
  }
  moveTo(state, p, clamp(tx, -mode.pitchW / 2 + 0.5, mode.pitchW / 2 - 0.5),
    clamp(ty, -mode.pitchH / 2 + 0.5, mode.pitchH / 2 - 0.5), JOG_SPEED * 0.95, cfg);
}
