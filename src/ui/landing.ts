// Landing page shown before the main menu, with an AI vs AI match running behind it.

export interface LandingApi {
  show(): void;
  hide(): void;
}

export function createLanding(onPlay: () => void): LandingApi {
  const root = document.createElement('div');
  root.className = 'overlay landing';
  root.innerHTML = `
    <div class="landing-inner">
      <div class="landing-badge">v0.2 &middot; playable build</div>
      <h1 class="title">TEAMBALL</h1>
      <p class="landing-tag">Passing-first 2D football, straight in your browser.</p>
      <p class="landing-sub">
        Take one team against the AI with PES-style mechanics. Assisted passing, through balls,
        crosses and shots with a power gauge, sprint, tackles, auto player switching, and a radar
        at the bottom of the screen. No install, no account. Pick a format and kick off in seconds.
      </p>
      <button class="play-cta" type="button">PLAY NOW</button>
      <div class="landing-modes">
        <div class="mode-card static">
          <div class="mode-name">2v2</div>
          <div class="mode-desc">24&times;14 m arcade mini pitch, no keeper</div>
        </div>
        <div class="mode-card static">
          <div class="mode-name">5v5</div>
          <div class="mode-desc">40&times;20 m futsal court with a keeper</div>
        </div>
        <div class="mode-card static">
          <div class="mode-name">11v11</div>
          <div class="mode-desc">105&times;68 m full pitch with offside</div>
        </div>
      </div>
      <div class="landing-feats">
        <span>PES-style controls</span><span>Keyboard + gamepad</span><span>Radar minimap</span>
        <span>Match stats</span><span>Runs at 60 fps</span><span>Free to play</span>
      </div>
      <div class="landing-hint">Desktop browser recommended. Press Esc in a match to pause.</div>
    </div>`;
  document.body.appendChild(root);

  const btn = root.querySelector<HTMLButtonElement>('.play-cta');
  btn?.addEventListener('click', onPlay);

  return {
    show(): void { root.classList.remove('hidden'); },
    hide(): void { root.classList.add('hidden'); },
  };
}
