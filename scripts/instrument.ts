// Instrumented run: log kicks, restarts, phase histogram to find stalls.
import { createMatchState } from './src/core/state';
import { step, SIM_DT } from './src/core/step';
import { NO_INPUTS } from './src/core/types';

const mode = process.argv[2] ?? '11v11';
const s = createMatchState({
  mode: mode as '11v11', homeTeam: 0, awayTeam: 1, difficulty: 'normal',
  halfSeconds: 180, offside: mode === '11v11',
});
s.rng = 99;

const phaseHisto: Record<string, number> = {};
const kickLog: string[] = [];
let lastPhase = s.phase;
let events = 0;

const t0 = Date.now();
let ticks = 0;
while (!s.finished && ticks < 60 * 150) {
  step(s, NO_INPUTS, SIM_DT);
  ticks++;
  phaseHisto[s.phase] = (phaseHisto[s.phase] ?? 0) + 1;
  if (s.phase !== lastPhase) {
    lastPhase = s.phase;
    events++;
    kickLog.push(`t=${(ticks * SIM_DT).toFixed(1)} -> ${s.phase}${s.restart ? `(${s.restart.kind},${s.restart.team})` : ''} ball=(${s.ball.x.toFixed(1)},${s.ball.y.toFixed(1)})`);
  }
  const passes = s.stats[0].passes + s.stats[1].passes;
  if (passes > events) {
    events = passes;
    kickLog.push(`t=${(ticks * SIM_DT).toFixed(1)} pass# ${passes} team=${s.ball.lastTouchTeam} ball=(${s.ball.x.toFixed(1)},${s.ball.y.toFixed(1)}) v=${Math.hypot(s.ball.vx, s.ball.vy).toFixed(1)}`);
  }
  if (kickLog.length > 400) kickLog.splice(0, 200);
}
console.log(`mode=${mode} finished=${s.finished} ticks=${ticks} (${(ticks / 60).toFixed(0)}s game, ${Date.now() - t0}ms)`);
console.log('phases:', JSON.stringify(phaseHisto));
console.log(`passes: ${s.stats[0].passes}+${s.stats[1].passes} ok ${s.stats[0].passesOk}+${s.stats[1].passesOk}`);
console.log('--- last 40 events ---');
console.log(kickLog.slice(-40).join('\n'));
