// Keyboard + gamepad input, merged into a per-frame Inputs snapshot.

import type { Inputs } from '../core/types';

const GAME_KEYS = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyF',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
]);

const DEADZONE = 0.22;

export class InputManager {
  private keys = new Set<string>();
  private disposers: (() => void)[] = [];

  attach(target: Window = window): void {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    this.disposers.push(() => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.keys.clear();
  }

  sample(): Inputs {
    const k = this.keys;
    let mx = 0, my = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my += 1;

    let sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    let pass = k.has('Space');
    let through = k.has('KeyE');
    let lob = k.has('KeyQ');
    let shoot = k.has('KeyF');
    let switchPlayer = k.has('Tab');
    let tackle = k.has('ControlLeft') || k.has('ControlRight');

    // gamepad (standard mapping, PES-style: A pass, B shoot, X lob, Y through)
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > DEADZONE) mx += ax;
      if (Math.abs(ay) > DEADZONE) my += ay;
      const b = (i: number) => (pad.buttons[i]?.pressed ?? false) || (pad.buttons[i]?.value ?? 0) > 0.5;
      if (b(5) || b(7)) sprint = true;               // RB / RT
      if (b(0)) pass = true;                          // A
      if (b(3)) through = true;                       // Y
      if (b(2)) lob = true;                           // X
      if (b(1)) shoot = true;                         // B
      if (b(4) || b(12) || b(13) || b(14) || b(15)) switchPlayer = true; // LB / dpad
    }

    return {
      mx: Math.max(-1, Math.min(1, mx)),
      my: Math.max(-1, Math.min(1, my)),
      sprint, pass, through, lob, shoot, switchPlayer, tackle,
    };
  }
}
