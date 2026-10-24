// ============================================================
// Teamball - ALL gameplay tuning lives here (see PRD §6.3).
// Units: meters, seconds, m/s, radians.
// ============================================================

import type { ModeId, Difficulty, Role } from './types';

// ---------- player physics ----------
export const PLAYER_R = 0.42; // collision radius
export const CONTROL_R = 0.95; // radius within which a player can touch the ball
export const JOG_SPEED = 5.0;
export const SPRINT_SPEED = 7.3;
export const GK_SPEED = 8.6;
export const ACCEL = 26; // m/s^2 toward desired velocity
export const LUNGE_SPEED = 9.5;
export const LUNGE_TIME = 0.28;
export const STUN_TIME = 0.5;
export const TOUCH_CD = 0.24; // passer cannot immediately re-capture
export const TOUCH_HOLD = 0.30; // GK hold before distributing

// ---------- ball physics ----------
export const BALL_R = 0.12; // render/threshold radius
export const GRAVITY = 11.5; // slightly above real for snappy arcs
export const GROUND_REST = 0.55; // bounce restitution
export const BOUNCE_DRAG = 0.78; // horizontal damping on bounce
export const ROLL_DECAY = 0.62; // exponential velocity decay per second while rolling
export const AIR_DECAY = 0.06;

// ---------- passing / shooting ----------
export const PASS_MIN_V = 8;
export const PASS_MAX_V = 24;
export const PASS_BASE_V = 7.5;
export const PASS_DIST_V = 0.32; // speed gained per meter of pass distance
export const PASS_POWER_V = 7.0; // speed gained per full power bar
export const THROUGH_MIN_V = 10;
export const THROUGH_MAX_V = 25;
export const SHOOT_MIN_V = 16;
export const SHOOT_POWER_V = 13;
export const SHOOT_MAX_V = 30;
export const HOLD_TIME = 0.55; // seconds to fill the power gauge
export const INPUT_BUFFER = 0.28; // seconds a pressed action waits for control

// ---------- AI ----------
export const AI_SETTINGS: Record<Difficulty, {
  reaction: number; // seconds between on-ball decisions
  passErr: number; // radians of pass noise
  press: number; // fraction of top speed when pressing
  noise: number; // movement noise
}> = {
  easy: { reaction: 0.55, passErr: 0.20, press: 0.82, noise: 0.35 },
  normal: { reaction: 0.34, passErr: 0.11, press: 0.94, noise: 0.2 },
  hard: { reaction: 0.18, passErr: 0.05, press: 1.0, noise: 0.1 },
};

// AI positioning: how much anchors stretch toward the ball
export const STRETCH_X = 0.24;
export const STRETCH_Y = 0.34;
export const ATTACK_PUSH = 8.5; // meters anchors push up when team has ball (11v11 scale)
export const DEFEND_DROP = 7.0;
export const COMPRESS_Y = 0.6; // how much anchors pinch toward ball y when defending
export const PRESS_COUNT: Record<ModeId, number> = { '2v2': 1, '5v5': 1, '11v11': 2 };

// ---------- rules ----------
export const RESTART_FREEZE = 0.7; // seconds players hold during restart placement
export const GOAL_BANNER = 2.4;
export const HALF_BANNER = 2.6;
export const OPP_CLEAR_R = 3.0; // opponents keep this distance at restarts
export const GK_DIVE_RANGE = 17; // meters: GK starts reacting to shots from here
export const GK_BOX = 16.5; // GK claims loose balls within this x-distance of goal

// ---------- modes ----------
export interface ModeDef {
  pitchW: number;
  pitchH: number;
  goalW: number;
  goalH: number;
  perTeam: number;
  hasGK: boolean;
  offside: boolean;
  defaultHalf: number; // seconds
  /** how many meters of pitch-height fit on screen (camera zoom) */
  viewH: number;
  surface: 'grass' | 'court';
  circleR: number; // center circle radius
  /** penalty area depth/width (meters), null = none (2v2) */
  boxD: number | null;
  boxW: number | null;
  /** inner 6-yard box for 11v11 */
  box6D: number | null;
  box6W: number | null;
}

export const MODES: Record<ModeId, ModeDef> = {
  '2v2': {
    pitchW: 24, pitchH: 14, goalW: 2.3, goalH: 1.9,
    perTeam: 2, hasGK: false, offside: false, defaultHalf: 120,
    viewH: 17, surface: 'grass', circleR: 2.0,
    boxD: null, boxW: null, box6D: null, box6W: null,
  },
  '5v5': {
    pitchW: 40, pitchH: 20, goalW: 3.0, goalH: 2.0,
    perTeam: 5, hasGK: true, offside: false, defaultHalf: 120,
    viewH: 24, surface: 'court', circleR: 3.0,
    boxD: 6, boxW: 12, box6D: null, box6W: null,
  },
  '11v11': {
    pitchW: 105, pitchH: 68, goalW: 7.32, goalH: 2.44,
    perTeam: 11, hasGK: true, offside: true, defaultHalf: 180,
    viewH: 46, surface: 'grass', circleR: 9.15,
    boxD: 16.5, boxW: 40.32, box6D: 5.5, box6W: 18.32,
  },
};

// ---------- formations ----------
// fx: 0 = own goal line, 1 = opponent goal line. fy: 0 = top touchline, 1 = bottom.
export interface Slot { fx: number; fy: number; role: Role }

export const FORMATIONS: Record<ModeId, Slot[]> = {
  '2v2': [
    { fx: 0.30, fy: 0.42, role: 'FB' },
    { fx: 0.62, fy: 0.58, role: 'FW' },
  ],
  '5v5': [
    { fx: 0.04, fy: 0.50, role: 'GK' },
    { fx: 0.22, fy: 0.34, role: 'FB' },
    { fx: 0.22, fy: 0.66, role: 'FB' },
    { fx: 0.42, fy: 0.50, role: 'MF' },
    { fx: 0.64, fy: 0.50, role: 'FW' },
  ],
  '11v11': [
    { fx: 0.02, fy: 0.50, role: 'GK' },
    { fx: 0.15, fy: 0.17, role: 'FB' },
    { fx: 0.13, fy: 0.38, role: 'FB' },
    { fx: 0.13, fy: 0.62, role: 'FB' },
    { fx: 0.15, fy: 0.83, role: 'FB' },
    { fx: 0.36, fy: 0.28, role: 'MF' },
    { fx: 0.34, fy: 0.50, role: 'MF' },
    { fx: 0.36, fy: 0.72, role: 'MF' },
    { fx: 0.56, fy: 0.15, role: 'FW' },
    { fx: 0.58, fy: 0.50, role: 'FW' },
    { fx: 0.56, fy: 0.85, role: 'FW' },
  ],
};

// ---------- teams (preset fiktif) ----------
export interface TeamDef { name: string; short: string; color: number; gk: number }

export const TEAMS: TeamDef[] = [
  { name: 'Crimson FC', short: 'CRM', color: 0xd7263d, gk: 0x27c2a1 },
  { name: 'Azure United', short: 'AZU', color: 0x1e88e5, gk: 0xffb300 },
  { name: 'Forest Rovers', short: 'FOR', color: 0x2e7d32, gk: 0xf4511e },
  { name: 'Sunstrike', short: 'SUN', color: 0xf9a825, gk: 0x3949ab },
  { name: 'Violet City', short: 'VIO', color: 0x8e24aa, gk: 0xc0ca33 },
  { name: 'Iron Athletic', short: 'IRO', color: 0x546e7a, gk: 0xec407a },
  { name: 'Coral Wanderers', short: 'COR', color: 0xff7043, gk: 0x26a69a },
  { name: 'Nightowl SC', short: 'NGO', color: 0x37474f, gk: 0xdce775 },
];
