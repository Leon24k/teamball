// DOM screens: main menu, HUD, banner, pause, full-time stats.

import type { MatchConfig, MatchState, ModeId, Difficulty } from '../core/types';
import { MODES, TEAMS } from '../core/constants';

export interface UIApi {
  updateHUD(state: MatchState): void;
  setMuted(muted: boolean): void;
  banner(state: MatchState): void;
  showMenu(): void;
  hideMenu(): void;
  showMatch(): void;
  showFulltime(state: MatchState, onRematch: () => void, onMenu: () => void): void;
  hideFulltime(): void;
  onPause(onResume: () => void, onRestart: () => void, onQuit: () => void): void;
  hidePause(): void;
  readonly lastConfig: MatchConfig | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function createUI(onStart: (config: MatchConfig) => void): UIApi {
  let lastConfig: MatchConfig | null = null;
  let lastBanner = '';

  // ---------- selection state ----------
  const sel = {
    mode: '11v11' as ModeId,
    home: 0,
    away: 1,
    diff: 'normal' as Difficulty,
    half: MODES['11v11'].defaultHalf,
    offside: true,
  };

  // ---------- menu ----------
  const menu = el('div', 'overlay');
  const panel = el('div', 'panel');
  panel.appendChild(el('h1', 'title', 'TEAMBALL'));
  panel.appendChild(el('p', 'tagline', '2D top-down football &middot; passing first &middot; PES-style controls'));

  const modeWrap = el('div', 'section');
  modeWrap.appendChild(el('div', 'section-label', 'FORMAT'));
  const cards = el('div', 'mode-cards');
  const cardEls: Record<string, HTMLElement> = {};
  for (const id of Object.keys(MODES) as ModeId[]) {
    const m = MODES[id];
    const card = el('div', 'mode-card');
    card.innerHTML = `
      <div class="mode-name">${id}</div>
      <div class="mode-desc">${m.pitchW}&times;${m.pitchH} m &middot; ${m.perTeam} per team${m.hasGK ? ' (incl. GK)' : ' &middot; no GK'}</div>
      <div class="mode-note">${id === '11v11' ? 'full pitch + offside' : id === '5v5' ? 'futsal court' : 'arcade mini pitch'}</div>`;
    card.addEventListener('click', () => {
      sel.mode = id;
      sel.half = m.defaultHalf;
      (halfSel as HTMLSelectElement).value = String(m.defaultHalf);
      offsideBox.disabled = !m.offside;
      if (!m.offside) { sel.offside = false; offsideBox.checked = false; }
      else { sel.offside = true; offsideBox.checked = true; }
      refreshSel();
    });
    cardEls[id] = card;
    cards.appendChild(card);
  }
  modeWrap.appendChild(cards);
  panel.appendChild(modeWrap);

  // team pickers
  const teamWrap = el('div', 'teams-row');
  const buildTeamRow = (side: 'home' | 'away') => {
    const wrap = el('div', 'team-pick');
    wrap.appendChild(el('div', 'section-label', side === 'home' ? 'HOME (YOU)' : 'AWAY (CPU)'));
    const chips = el('div', 'team-chips');
    const chipEls: HTMLElement[] = [];
    TEAMS.forEach((t, i) => {
      const chip = el('button', 'team-chip');
      chip.style.background = cssColor(t.color);
      chip.title = t.name;
      chip.addEventListener('click', () => {
        if (sel[side === 'home' ? 'away' : 'home'] === i) return; // no mirror matches
        sel[side] = i;
        refreshSel();
      });
      chipEls.push(chip);
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    return { wrap, chipEls };
  };
  const homeRow = buildTeamRow('home');
  const awayRow = buildTeamRow('away');
  teamWrap.appendChild(homeRow.wrap);
  teamWrap.appendChild(awayRow.wrap);
  panel.appendChild(teamWrap);

  // options row
  const optWrap = el('div', 'opts-row');

  const diffWrap = el('div', 'opt');
  diffWrap.appendChild(el('div', 'section-label', 'DIFFICULTY'));
  const diffSeg = el('div', 'segmented');
  const diffEls: HTMLElement[] = [];
  (['easy', 'normal', 'hard'] as Difficulty[]).forEach((d) => {
    const b = el('button', 'seg-btn', d.toUpperCase());
    b.addEventListener('click', () => { sel.diff = d; refreshSel(); });
    diffEls.push(b);
    diffSeg.appendChild(b);
  });
  diffWrap.appendChild(diffSeg);
  optWrap.appendChild(diffWrap);

  const halfWrap = el('div', 'opt');
  halfWrap.appendChild(el('div', 'section-label', 'HALF LENGTH'));
  const halfSel = el('select', 'select') as HTMLSelectElement;
  for (const min of [2, 3, 4, 5]) {
    const o = el('option', '', `${min} min`);
    o.value = String(min * 60);
    halfSel.appendChild(o);
  }
  halfSel.value = String(sel.half);
  halfSel.addEventListener('change', () => { sel.half = Number(halfSel.value); });
  halfWrap.appendChild(halfSel);
  optWrap.appendChild(halfWrap);

  const offWrap = el('div', 'opt');
  offWrap.appendChild(el('div', 'section-label', 'OFFSIDE'));
  const offLabel = el('label', 'toggle');
  const offsideBox = el('input') as HTMLInputElement;
  offsideBox.type = 'checkbox';
  offsideBox.checked = true;
  offsideBox.addEventListener('change', () => { sel.offside = offsideBox.checked; });
  offLabel.appendChild(offsideBox);
  offLabel.appendChild(el('span', '', ' on (11v11)'));
  offWrap.appendChild(offLabel);
  optWrap.appendChild(offWrap);
  panel.appendChild(optWrap);

  // controls legend
  const ctrl = el('div', 'controls');
  ctrl.innerHTML = `
    <div class="section-label">CONTROLS</div>
    <div class="ctrl-grid">
      <span><kbd>WASD</kbd> move</span><span><kbd>Shift</kbd> sprint</span>
      <span><kbd>Space</kbd> short pass</span><span><kbd>E</kbd> through ball</span>
      <span><kbd>Q</kbd> long ball / cross</span><span><kbd>F</kbd> shoot</span>
      <span><kbd>Tab</kbd> switch player</span><span><kbd>Ctrl</kbd> tackle</span>
      <span><kbd>Esc</kbd> pause</span><span><kbd>M</kbd> mute</span><span><kbd>Gamepad</kbd> supported</span>
    </div>`;
  panel.appendChild(ctrl);

  const startBtn = el('button', 'start-btn', 'KICK-OFF');
  startBtn.addEventListener('click', () => {
    onStart({
      mode: sel.mode,
      homeTeam: sel.home,
      awayTeam: sel.away,
      difficulty: sel.diff,
      halfSeconds: sel.half,
      offside: sel.offside,
    });
  });
  panel.appendChild(startBtn);
  menu.appendChild(panel);
  document.body.appendChild(menu);

  function refreshSel(): void {
    for (const id of Object.keys(cardEls)) cardEls[id]!.classList.toggle('sel', id === sel.mode);
    homeRow.chipEls.forEach((c, i) => c.classList.toggle('sel', i === sel.home));
    awayRow.chipEls.forEach((c, i) => c.classList.toggle('sel', i === sel.away));
    diffEls.forEach((b, i) => b.classList.toggle('sel', ['easy', 'normal', 'hard'][i] === sel.diff));
  }
  refreshSel();

  // ---------- HUD ----------
  const hud = el('div', 'hud hidden');
  hud.innerHTML = `
    <div class="score-row">
      <span id="hud-home" class="chip"></span>
      <span id="hud-score" class="score">0 : 0</span>
      <span id="hud-away" class="chip"></span>
    </div>
    <div class="clock-row"><span id="hud-clock">00:00</span><span id="hud-half">1ST</span><span id="hud-att"></span><span id="hud-mute"></span></div>
    <div id="hud-poss" class="poss">50% - 50%</div>`;
  document.body.appendChild(hud);

  // ---------- banner ----------
  const banner = el('div', 'banner hidden');
  document.body.appendChild(banner);

  // ---------- pause ----------
  const pause = el('div', 'overlay hidden');
  const pausePanel = el('div', 'panel small');
  pausePanel.appendChild(el('h2', 'subtitle', 'PAUSED'));
  const pauseBtns = el('div', 'btn-col');
  const mkBtn = (label: string, cb: () => void) => {
    const b = el('button', 'menu-btn', label);
    b.addEventListener('click', cb);
    return b;
  };
  let resumeCb: () => void = () => {};
  let restartCb: () => void = () => {};
  let quitCb: () => void = () => {};
  pauseBtns.appendChild(mkBtn('RESUME', () => resumeCb()));
  pauseBtns.appendChild(mkBtn('RESTART MATCH', () => restartCb()));
  pauseBtns.appendChild(mkBtn('QUIT TO MENU', () => quitCb()));
  pausePanel.appendChild(pauseBtns);
  pause.appendChild(pausePanel);
  document.body.appendChild(pause);

  // ---------- full time ----------
  const fulltime = el('div', 'overlay hidden');
  const ftPanel = el('div', 'panel small');
  const ftTitle = el('h2', 'subtitle', 'FULL-TIME');
  const ftScore = el('div', 'ft-score');
  const ftTable = el('div', 'ft-table');
  const ftBtns = el('div', 'btn-col row');
  let rematchCb: () => void = () => {};
  let ftMenuCb: () => void = () => {};
  ftBtns.appendChild(mkBtn('REMATCH', () => rematchCb()));
  ftBtns.appendChild(mkBtn('MAIN MENU', () => ftMenuCb()));
  ftPanel.appendChild(ftTitle);
  ftPanel.appendChild(ftScore);
  ftPanel.appendChild(ftTable);
  ftPanel.appendChild(ftBtns);
  fulltime.appendChild(ftPanel);
  document.body.appendChild(fulltime);

  // ---------- API ----------
  return {
    get lastConfig() { return lastConfig; },

    showMenu(): void {
      menu.classList.remove('hidden');
      hud.classList.add('hidden');
      pause.classList.add('hidden');
      fulltime.classList.add('hidden');
      banner.classList.add('hidden');
    },

    hideMenu(): void {
      menu.classList.add('hidden');
    },

    showMatch(): void {
      menu.classList.add('hidden');
      fulltime.classList.add('hidden');
      pause.classList.add('hidden');
      hud.classList.remove('hidden');
      const home = document.getElementById('hud-home')!;
      const away = document.getElementById('hud-away')!;
      home.textContent = TEAMS[sel.home].short;
      away.textContent = TEAMS[sel.away].short;
      (home as HTMLElement).style.background = cssColor(TEAMS[sel.home].color);
      (away as HTMLElement).style.background = cssColor(TEAMS[sel.away].color);
      lastBanner = '';
    },

    updateHUD(state: MatchState): void {
      // write to the DOM only when a value actually changed (per-frame safe)
      const set = (id: string, v: string) => {
        const node = document.getElementById(id);
        if (node && node.textContent !== v) node.textContent = v;
      };
      set('hud-score', `${state.score[0]} : ${state.score[1]}`);
      const t = Math.min(state.time, state.config.halfSeconds);
      const mm = String(Math.floor(t / 60)).padStart(2, '0');
      const ss = String(Math.floor(t % 60)).padStart(2, '0');
      set('hud-clock', `${mm}:${ss}`);
      set('hud-half', state.half === 1 ? '1ST' : '2ND');
      set('hud-att', `ATTACK ${state.attackDir[0] > 0 ? '\u2192' : '\u2190'}`);
      const tot = state.possession[0] + state.possession[1];
      const p0 = tot > 0 ? Math.round((state.possession[0] / tot) * 100) : 50;
      set('hud-poss', `${p0}% - ${100 - p0}%`);
    },

    setMuted(muted: boolean): void {
      const e2 = document.getElementById('hud-mute');
      if (e2) e2.textContent = muted ? 'MUTED (M)' : '';
    },

    banner(state: MatchState): void {
      if (state.messageTimer > 0 && state.message && state.message !== lastBanner) {
        lastBanner = state.message;
        banner.textContent = state.message;
        banner.classList.remove('hidden');
        banner.style.animation = 'none';
        void banner.offsetWidth; // reflow to restart the CSS animation
        banner.style.animation = '';
      } else if (state.messageTimer <= 0 && !banner.classList.contains('hidden')) {
        banner.classList.add('hidden');
        lastBanner = '';
      }
    },

    onPause(onResume, onRestart, onQuit): void {
      resumeCb = onResume; restartCb = onRestart; quitCb = onQuit;
      pause.classList.remove('hidden');
    },

    hidePause(): void { pause.classList.add('hidden'); },

    showFulltime(state, onRematch, onMenu): void {
      rematchCb = onRematch; ftMenuCb = onMenu;
      const home = TEAMS[state.config.homeTeam];
      const away = TEAMS[state.config.awayTeam];
      ftScore.innerHTML = `
        <span class="chip" style="background:${cssColor(home.color)}">${home.short}</span>
        <span class="score">${state.score[0]} : ${state.score[1]}</span>
        <span class="chip" style="background:${cssColor(away.color)}">${away.short}</span>`;
      const tot = state.possession[0] + state.possession[1];
      const p0 = tot > 0 ? Math.round((state.possession[0] / tot) * 100) : 50;
      const s0 = state.stats[0], s1 = state.stats[1];
      const passAcc = (st: typeof s0) => (st.passes > 0 ? Math.round((st.passesOk / st.passes) * 100) : 0);
      const row = (label: string, a: string | number, b: string | number) =>
        `<div class="ft-row"><span>${a}</span><span class="ft-label">${label}</span><span>${b}</span></div>`;
      ftTable.innerHTML =
        row('GOALS', state.score[0], state.score[1]) +
        row('SHOTS', s0.shots, s1.shots) +
        row('ON TARGET', s0.shotsOnTarget, s1.shotsOnTarget) +
        row('PASSES', `${s0.passesOk}/${s0.passes}`, `${s1.passesOk}/${s1.passes}`) +
        row('PASS ACCURACY', `${passAcc(s0)}%`, `${passAcc(s1)}%`) +
        row('BEST PASS STREAK', s0.bestStreak, s1.bestStreak) +
        row('POSSESSION', `${p0}%`, `${100 - p0}%`);
      fulltime.classList.remove('hidden');
    },

    hideFulltime(): void { fulltime.classList.add('hidden'); },
  };
}

function cssColor(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
