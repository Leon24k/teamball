// Full-match balance check: run complete matches per mode, report outcomes.
import { createMatchState } from './src/core/state';
import { step, SIM_DT } from './src/core/step';
import { NO_INPUTS } from './src/core/types';

const MODES = ['11v11', '5v5', '2v2'] as const;

for (const mode of MODES) {
  const s = createMatchState({
    mode, homeTeam: 0, awayTeam: 1, difficulty: 'normal',
    halfSeconds: 180, offside: mode === '11v11',
  });
  s.rng = 1000 + mode.length * 7;
  const t0 = Date.now();
  let ticks = 0;
  while (!s.finished && ticks < 60 * 60 * 20) {
    step(s, NO_INPUTS, SIM_DT);
    ticks++;
  }
  const [a, b] = s.stats;
  console.log(
    `${mode.padEnd(5)} | score ${s.score[0]}-${s.score[1]} | shots ${a.shots}-${b.shots} (on target ${a.shotsOnTarget}-${b.shotsOnTarget})` +
    ` | passes ${a.passesOk}/${a.passes} - ${b.passesOk}/${b.passes}` +
    ` | streak ${a.bestStreak}-${b.bestStreak} | finished=${s.finished} | sim ${(ticks / 60).toFixed(0)}s game in ${Date.now() - t0}ms`,
  );
}
