// ============================================================
// Teamball - core types. Pure data, no DOM/Pixi imports here.
// The whole core must stay portable (port to Rust/WASM later).
// ============================================================

export type ModeId = '2v2' | '5v5' | '11v11';
export type TeamSide = 0 | 1; // 0 = home (user), 1 = away (AI)
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Role = 'GK' | 'FB' | 'MF' | 'FW';

/** Freeze-phased match flow. 'play' = ball live, everything else = frozen or semi-frozen. */
export type Phase =
  | 'kickoff' // ball at center, waiting for first touch (restart-like but with kickoff rules)
  | 'restart' // kick-in / corner / goal kick / free kick: ball placed, taker walks to it
  | 'play'
  | 'goal' // banner freeze after goal
  | 'halftime'
  | 'fulltime';

export interface MatchConfig {
  mode: ModeId;
  homeTeam: number; // index into TEAMS
  awayTeam: number;
  difficulty: Difficulty;
  halfSeconds: number;
  offside: boolean;
}

export interface Inputs {
  /** analog move vector, magnitude 0..1 */
  mx: number;
  my: number;
  sprint: boolean;
  /** button held state; core detects edges and measures hold time itself */
  pass: boolean;
  through: boolean;
  lob: boolean;
  shoot: boolean;
  switchPlayer: boolean;
  tackle: boolean;
}

export const NO_INPUTS: Inputs = {
  mx: 0, my: 0, sprint: false,
  pass: false, through: false, lob: false, shoot: false,
  switchPlayer: false, tackle: false,
};

export interface PlayerState {
  id: number;
  team: TeamSide;
  role: Role;
  num: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** movement intent written by AI or user input each tick (m/s) */
  dvx: number;
  dvy: number;
  facing: number; // radians
  /** formation anchor, world meters (recomputed on side swap) */
  ax: number;
  ay: number;
  /** where this player currently wants to stand (AI writes, meters) */
  tx: number;
  ty: number;
  isGK: boolean;
  /** seconds until this player may touch the ball again */
  touchCd: number;
  /** active tackle lunge timer */
  lunge: number;
  /** beaten/slowed timer after failed tackle */
  stun: number;
  /** AI on-ball decision countdown */
  decCd: number;
  /** AI current dribble/heading direction (radians) */
  aiDir: number;
}

export interface BallState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  lastTouchPlayer: number; // -1 = none
  lastTouchTeam: number; // -1 = none
  /** GK currently holding the ball (player id) or -1 */
  heldBy: number;
  heldTimer: number;
}

export interface TeamStats {
  passes: number;
  passesOk: number;
  shots: number;
  shotsOnTarget: number;
  /** consecutive completed passes by the team, live */
  streak: number;
  bestStreak: number;
}

export type RestartKind = 'kickoff' | 'kickin' | 'corner' | 'goalkick' | 'freekick';

export interface RestartInfo {
  kind: RestartKind;
  team: TeamSide; // team entitled to the ball
  x: number;
  y: number;
  taker: number; // player id
}

export interface PendingPass {
  team: TeamSide;
  passer: number;
  /** true when this was a shot (for on-target stats) */
  isShot?: boolean;
}

export type QueuedActionType = 'pass' | 'through' | 'lob' | 'shoot';

export interface QueuedAction {
  type: QueuedActionType;
  power: number; // 0..1
  life: number; // buffer window seconds
}

export interface MatchState {
  config: MatchConfig;
  rng: number; // mulberry32 state
  time: number; // seconds elapsed in current half
  half: 1 | 2;
  phase: Phase;
  phaseTimer: number;
  players: PlayerState[];
  ball: BallState;
  score: [number, number];
  possession: [number, number]; // tick counts
  stats: [TeamStats, TeamStats];
  controlled: number; // user-controlled player id
  switchCd: number;
  /** +1 = attacks +x, -1 = attacks -x. [home, away] */
  attackDir: [number, number];
  offsideFlags: number[]; // player ids flagged at last forward pass
  offsideTeam: number; // team whose players are flagged, -1 none
  pendingPass: PendingPass | null;
  restart: RestartInfo | null;
  /** true from first touch after kickoff/restart until next dead ball */
  live: boolean;
  /** transient UI banner text ('' = none). Set by rules, read by render. */
  message: string;
  messageTimer: number;
  /** input snapshot of the current tick (used by AI target choice etc.) */
  inputs: Inputs;
  prevInputs: Inputs | null;
  /** ball.lastTouchPlayer of the previous tick (detect possession changes) */
  prevTouchPlayer: number;
  /** measured hold times 0..1 for the four power buttons */
  hold: { pass: number; through: number; lob: number; shoot: number };
  queued: QueuedAction | null;
  /** team that kicks off after the current goal banner (kickoff for conceding side) */
  kickoffNext: TeamSide;
  finished: boolean;
}
