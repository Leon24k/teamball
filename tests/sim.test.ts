// Headless simulation smoke tests - the core must run without a browser.

import { describe, it, expect } from 'vitest';
import { createMatchState, setupKickoff, swapSides } from '../src/core/state';
import { step, SIM_DT } from '../src/core/step';
import { NO_INPUTS, type MatchConfig } from '../src/core/types';

function make(mode: MatchConfig['mode'], halfSeconds = 60): ReturnType<typeof createMatchState> {
  const s = createMatchState({
    mode, homeTeam: 0, awayTeam: 1, difficulty: 'normal',
    halfSeconds, offside: mode === '11v11',
  });
  s.rng = 42;
  return s;
}

function run(s: ReturnType<typeof createMatchState>, seconds: number, inputs = NO_INPUTS): void {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) step(s, inputs, SIM_DT);
}

function expectFinite(s: ReturnType<typeof createMatchState>): void {
  const b = s.ball;
  expect([b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite)).toBe(true);
  for (const p of s.players) {
    expect([p.x, p.y, p.vx, p.vy].every(Number.isFinite)).toBe(true);
  }
}

describe('simulation smoke', () => {
  for (const mode of ['2v2', '5v5', '11v11'] as const) {
    it(`${mode}: starts at kickoff and goes live`, () => {
      const s = make(mode);
      expect(s.phase).toBe('kickoff');
      run(s, 4);
      expect(['kickoff', 'play', 'restart']).toContain(s.phase);
      expectFinite(s);
    });

    it(`${mode}: plays 90 seconds with AI activity, no NaN`, () => {
      const s = make(mode);
      run(s, 90);
      expectFinite(s);
      expect(s.stats[0].passes + s.stats[1].passes).toBeGreaterThan(0);
      expect(s.possession[0] + s.possession[1]).toBeGreaterThan(0);
    });

    it(`${mode}: finishes a full match (2 halves)`, () => {
      const s = make(mode, 5);
      run(s, 120);
      expectFinite(s);
      expect(s.finished).toBe(true);
      expect(s.phase).toBe('fulltime');
    });
  }

  it('deterministic: same seed and inputs produce identical states', () => {
    const a = make('11v11');
    const b = make('11v11');
    a.rng = 7;
    b.rng = 7;
    run(a, 45);
    run(b, 45);
    expect(a.ball.x).toBe(b.ball.x);
    expect(a.ball.y).toBe(b.ball.y);
    expect(a.score[0]).toBe(b.score[0]);
    expect(a.score[1]).toBe(b.score[1]);
    expect(a.stats[0].passes).toBe(b.stats[0].passes);
    for (let i = 0; i < a.players.length; i++) {
      expect(a.players[i].x).toBe(b.players[i].x);
      expect(a.players[i].y).toBe(b.players[i].y);
    }
  });

  it('user can pass from kickoff by holding Space', () => {
    const s = make('5v5');
    // put the controlled taker right on top of the ball (deterministic setup)
    const taker = s.players[s.controlled];
    taker.x = -0.4; taker.y = 0.2;
    s.ball.x = -0.2; s.ball.y = 0.3;
    run(s, 0.25, { ...NO_INPUTS, pass: true }); // charge the gauge
    run(s, 0.05);                               // release edge -> kick
    expect(s.stats[0].passes).toBeGreaterThan(0);
    run(s, 2.0);                                // someone collects the ball
    expect(s.live).toBe(true);
  });

  it('kickoff places every team strictly in its own half, in both halves of the match', () => {
    const s = make('11v11');
    const assertOwnHalf = () => {
      for (const p of s.players) {
        if (p.isGK) continue;
        // depth in own half along this team's attack direction must be negative
        expect(p.x * s.attackDir[p.team]).toBeLessThanOrEqual(-0.9);
      }
    };
    assertOwnHalf();
    // second half: sides swap, kickoff again
    swapSides(s);
    setupKickoff(s, 1);
    assertOwnHalf();
  });

  it('scripted player can run, trap, and pass on repeat (user-loop regression)', () => {
    const s = make('11v11', 30);
    let holdN = 0;
    let cooldown = 0;
    for (let i = 0; i < 30 / SIM_DT; i++) {
      const me = s.players[s.controlled];
      if (!me) break;
      const b = s.ball;
      const dx = b.x - me.x, dy = b.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      if (cooldown > 0) cooldown--;
      if (holdN === 0 && cooldown === 0 && d < 2.2) holdN = 13; // start charging
      let passDown = false;
      if (holdN > 0) {
        passDown = true;
        holdN--;
        if (holdN === 0) cooldown = 90; // released; wait 1.5s before next pass
      }
      step(s, {
        ...NO_INPUTS,
        mx: dx / d, my: dy / d,
        sprint: d > 6,
        pass: passDown,
      }, SIM_DT);
    }
    expectFinite(s);
    expect(s.stats[0].passes).toBeGreaterThan(3);
    expect(s.possession[0]).toBeGreaterThan(0);
  });

  it('scripted player can pass upfield and shoot (full user loop)', () => {
    const s = make('11v11', 60);
    let passHold = 0;
    let passCd = 0;
    let shootHold = 0;
    let shootCd = 0;
    for (let i = 0; i < 60 / SIM_DT; i++) {
      const me = s.players[s.controlled];
      if (!me) break;
      const b = s.ball;
      const dx = b.x - me.x, dy = b.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      const att = s.attackDir[0];
      const gx = att * 52.5;
      const dGoal = Math.hypot(gx - me.x, -me.y);
      if (passCd > 0) passCd--;
      if (shootCd > 0) shootCd--;
      const carrying = b.lastTouchPlayer === me.id && d < 3;
      const atFeet = b.lastTouchPlayer === me.id && d < 1.5;
      let pressured = false;
      for (const q of s.players) {
        if (q.team === 1 && Math.hypot(q.x - me.x, q.y - me.y) < 3) { pressured = true; break; }
      }
      if (shootHold === 0 && shootCd === 0 && atFeet && dGoal < 28) shootHold = 9;
      else if (passHold === 0 && passCd === 0 && carrying && (pressured || dGoal > 25)) passHold = 9;
      let passDown = false;
      let shootDown = false;
      if (shootHold > 0) {
        shootDown = true;
        shootHold--;
        if (shootHold === 0) shootCd = 200;
      } else if (passHold > 0) {
        passDown = true;
        passHold--;
        if (passHold === 0) passCd = 80;
      }
      step(s, {
        ...NO_INPUTS,
        mx: atFeet || shootDown ? att : dx / d,
        my: atFeet || shootDown ? 0 : dy / d,
        sprint: d > 2,
        pass: passDown,
        shoot: shootDown,
      }, SIM_DT);
    }
    expectFinite(s);
    expect(s.stats[0].passes).toBeGreaterThan(2);
    expect(s.stats[0].shots).toBeGreaterThan(0);
  });

  it('players stay on/near the pitch', () => {
    const s = make('11v11');
    run(s, 60);
    for (const p of s.players) {
      expect(Math.abs(p.x)).toBeLessThan(60);
      expect(Math.abs(p.y)).toBeLessThan(40);
    }
  });
});
