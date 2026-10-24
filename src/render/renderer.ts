// PixiJS v8 match renderer: pitch, players, ball, camera, bottom radar, power gauge.

import { Container, Graphics, type Application } from 'pixi.js';
import type { MatchState } from '../core/types';
import { MODES, TEAMS } from '../core/constants';
import { clamp } from '../core/math';

interface PlayerView {
  root: Container;
  body: Graphics;   // rotates with facing
  ring: Graphics;   // controlled highlight (under feet)
  tri: Graphics;    // controlled indicator (above head)
}

export class MatchRenderer {
  readonly world = new Container();
  readonly screenSpace = new Container();
  private pitchG = new Graphics();
  private playerViews: PlayerView[] = [];
  private ballShadow = new Graphics();
  private ballG = new Graphics();
  private radarG = new Graphics();
  private radarBg = new Graphics();
  private gaugeG = new Graphics();
  private fxG = new Graphics();

  // interpolated camera position (time-corrected smoothing)
  private camX = 0;
  private camY = 0;
  private ppm = 10;
  private radarW = 0;
  private radarH = 0;
  private lastFrameT = 0;

  // previous-tick positions for render interpolation
  private prev = { px: new Float64Array(0), py: new Float64Array(0), bx: 0, by: 0, bz: 0 };

  // game feel: goal screen shake + kick puffs
  private shakeT = 0;
  private puffs: { x: number; y: number; age: number }[] = [];

  constructor(private app: Application, private state: MatchState) {
    this.world.addChild(this.pitchG);
    this.world.addChild(this.ballShadow);
    this.buildPitch();
    this.buildPlayers();
    this.world.addChild(this.ballG);
    this.screenSpace.addChild(this.radarBg);
    this.screenSpace.addChild(this.radarG);
    this.world.addChild(this.gaugeG);
    this.gaugeG.zIndex = 9500;
    this.fxG.zIndex = 9000;
    this.world.addChild(this.fxG);
    this.savePrev(state);
    this.camX = state.ball.x;
    this.camY = state.ball.y;
    this.lastFrameT = performance.now();
  }

  /** Copy current positions before a sim tick (for interpolation). */
  savePrev(state: MatchState): void {
    if (this.prev.px.length !== state.players.length) {
      this.prev.px = new Float64Array(state.players.length);
      this.prev.py = new Float64Array(state.players.length);
    }
    state.players.forEach((p, i) => {
      this.prev.px[i] = p.x;
      this.prev.py[i] = p.y;
    });
    this.prev.bx = state.ball.x;
    this.prev.by = state.ball.y;
    this.prev.bz = state.ball.z;
  }

  private modeDef() {
    return MODES[this.state.config.mode];
  }

  private buildPitch(): void {
    const m = this.modeDef();
    const g = this.pitchG;
    const hw = m.pitchW / 2;
    const hh = m.pitchH / 2;
    const apron = 6;

    g.clear();
    // apron
    g.rect(-hw - apron, -hh - apron * 0.8, m.pitchW + apron * 2, m.pitchH + apron * 1.6)
      .fill(m.surface === 'court' ? 0x14181f : 0x0d2415);

    // surface
    if (m.surface === 'grass') {
      const bands = 12;
      const bw = m.pitchW / bands;
      for (let i = 0; i < bands; i++) {
        g.rect(-hw + i * bw, -hh, bw, m.pitchH)
          .fill(i % 2 === 0 ? 0x2e7d32 : 0x2a7330);
      }
    } else {
      g.rect(-hw, -hh, m.pitchW, m.pitchH).fill(0x1f4e5f);
    }

    // markings
    const line = 0.14;
    const white = 0xf2f6f0;
    g.rect(-hw, -hh, m.pitchW, m.pitchH).stroke({ width: line, color: white });
    g.moveTo(0, -hh).lineTo(0, hh).stroke({ width: line, color: white });
    g.circle(0, 0, m.circleR).stroke({ width: line, color: white });
    g.circle(0, 0, 0.25).fill(white);

    if (m.boxD !== null && m.boxW !== null) {
      for (const s of [-1, 1]) {
        const x = s > 0 ? hw - m.boxD : -hw;
        g.rect(x, -m.boxW / 2, m.boxD, m.boxW).stroke({ width: line, color: white });
        if (m.surface === 'court') {
          // futsal goal-area semicircle
          const cx = s > 0 ? hw : -hw;
          g.arc(cx, 0, m.boxD, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? (Math.PI * 3) / 2 : Math.PI / 2)
            .stroke({ width: line, color: white });
        }
        if (m.box6D !== null && m.box6W !== null) {
          const x6 = s > 0 ? hw - m.box6D : -hw;
          g.rect(x6, -m.box6W / 2, m.box6D, m.box6W).stroke({ width: line, color: white });
        }
        // penalty spot
        const px = s > 0 ? hw - 11 : -hw + 11;
        g.circle(px, 0, 0.22).fill(white);
        // corner arcs
        for (const sy of [-1, 1]) {
          g.arc(s * hw, sy * hh, 1, 0, Math.PI * 2).stroke({ width: line, color: white });
        }
      }
    } else {
      for (const s of [-1, 1]) {
        for (const sy of [-1, 1]) {
          g.arc(s * hw, sy * hh, 0.8, 0, Math.PI * 2).stroke({ width: line, color: white });
        }
      }
    }

    // goals (net boxes behind the goal lines)
    for (const s of [-1, 1]) {
      const gx = s > 0 ? hw : -hw - 1.8;
      g.rect(gx, -m.goalW / 2, 1.8, m.goalW).fill({ color: 0xdadfe6, alpha: 0.35 });
      g.rect(gx, -m.goalW / 2, 1.8, m.goalW).stroke({ width: 0.18, color: 0xffffff });
    }
  }

  private buildPlayers(): void {
    const home = TEAMS[this.state.config.homeTeam];
    const away = TEAMS[this.state.config.awayTeam];
    this.state.players.forEach((p) => {
      const teamDef = p.team === 0 ? home : away;
      const color = p.isGK ? teamDef.gk : teamDef.color;
      const root = new Container();

      const ring = new Graphics();
      ring.circle(0, 0, 0.68).stroke({ width: 0.1, color: 0xffe082, alpha: 0.95 });
      ring.visible = false;
      root.addChild(ring);

      const body = new Graphics();
      const darker = shade(color, -0.35);
      body.circle(0, 0, 0.45).fill(color).stroke({ width: 0.07, color: darker });
      // facing wedge
      body.moveTo(0.18, -0.2).lineTo(0.62, 0).lineTo(0.18, 0.2).closePath().fill(darker);
      root.addChild(body);

      const tri = new Graphics();
      tri.poly([0, -1.35, -0.3, -0.85, 0.3, -0.85]).fill(0xffe082);
      tri.visible = false;
      root.addChild(tri);

      root.zIndex = 1000; // base above pitch; refined per frame from y
      this.world.addChild(root);
      this.playerViews.push({ root, body, ring, tri });
    });
    this.world.sortableChildren = true;
  }

  destroy(): void {
    this.world.destroy({ children: true });
    this.screenSpace.destroy({ children: true });
  }

  /** Trigger a goal celebration screen shake. */
  shake(seconds = 0.5): void {
    this.shakeT = Math.max(this.shakeT, seconds);
  }

  /** Spawn a small kick puff at a world position. */
  puff(x: number, y: number): void {
    if (this.puffs.length > 12) this.puffs.shift();
    this.puffs.push({ x, y, age: 0 });
  }

  render(alpha: number): void {
    const s = this.state;
    const m = this.modeDef();
    const now = performance.now();
    const dtF = Math.min(0.05, Math.max(0.001, (now - this.lastFrameT) / 1000));
    this.lastFrameT = now;

    // interpolated positions (snap across teleports like kickoff placement)
    const bJump = Math.abs(s.ball.x - this.prev.bx) + Math.abs(s.ball.y - this.prev.by) > 8;
    const bx = bJump ? s.ball.x : this.prev.bx + (s.ball.x - this.prev.bx) * alpha;
    const by = bJump ? s.ball.y : this.prev.by + (s.ball.y - this.prev.by) * alpha;
    const bz = bJump ? s.ball.z : this.prev.bz + (s.ball.z - this.prev.bz) * alpha;

    this.playerViews.forEach((v, i) => {
      const p = s.players[i];
      if (!p) return;
      const jumped = Math.abs(p.x - this.prev.px[i]) + Math.abs(p.y - this.prev.py[i]) > 8;
      const x = jumped ? p.x : this.prev.px[i] + (p.x - this.prev.px[i]) * alpha;
      const y = jumped ? p.y : this.prev.py[i] + (p.y - this.prev.py[i]) * alpha;
      v.root.position.set(x, y);
      // layering by depth; base 1000 keeps everyone above the pitch (zIndex 0)
      // even at negative pitch coordinates (the top half of the field)
      v.root.zIndex = 1000 + Math.round(y * 10);
      v.body.rotation = p.facing;
      const mine = p.id === s.controlled;
      v.ring.visible = mine;
      v.tri.visible = mine;
      v.body.alpha = p.stun > 0 ? 0.55 : 1;
    });

    // ball + shadow
    this.ballShadow.clear();
    this.ballShadow.circle(bx, by, 0.17 / (1 + bz * 0.5)).fill({ color: 0x000000, alpha: 0.35 / (1 + bz) });
    this.ballG.clear();
    this.ballG.circle(bx, by - bz * 0.85, 0.17 + Math.min(bz * 0.03, 0.08))
      .fill(0xffffff).stroke({ width: 0.05, color: 0x222222 });
    this.ballG.zIndex = 5000;

    // camera: time-corrected exponential smoothing (frame-rate independent)
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.ppm = h / m.viewH;
    const leadX = clamp(s.ball.vx * 0.35, -6, 6);
    const leadY = clamp(s.ball.vy * 0.3, -4, 4);
    const tx = bx + leadX;
    const ty = by + leadY;
    const k = 1 - Math.exp(-dtF / 0.11);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    // goal shake: jitter the camera center while it decays
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dtF;
      shakeX = (Math.random() - 0.5) * this.shakeT * 2.2;
      shakeY = (Math.random() - 0.5) * this.shakeT * 1.6;
    }
    const hw = m.pitchW / 2 + 6;
    const hh = m.pitchH / 2 + 5;
    const visW = w / this.ppm / 2;
    const visH = h / this.ppm / 2;
    let cx = this.camX;
    let cy = this.camY;
    cx = hw - visW > 0 ? clamp(cx, -(hw - visW), hw - visW) : 0;
    cy = hh - visH > 0 ? clamp(cy, -(hh - visH), hh - visH) : 0;
    this.world.scale.set(this.ppm);
    this.world.position.set(w / 2 - (cx + shakeX) * this.ppm, h / 2 - (cy + shakeY) * this.ppm);

    // kick puffs: redraw the persistent effect layer (no per-frame allocations)
    this.fxG.clear();
    if (this.puffs.length > 0) {
      const life = 0.3;
      for (const p of this.puffs) {
        p.age += dtF;
        if (p.age >= life) continue;
        const r = 0.35 + p.age * 5;
        this.fxG.circle(p.x, p.y, r).stroke({
          width: 0.12, color: 0xffffff, alpha: 0.5 * (1 - p.age / life),
        });
      }
      this.puffs = this.puffs.filter((p) => p.age < life);
    }

    this.drawRadar(w, h);
    this.drawGauge();
  }

  private drawRadar(w: number, h: number): void {
    const s = this.state;
    const m = this.modeDef();
    const home = TEAMS[s.config.homeTeam];
    const away = TEAMS[s.config.awayTeam];
    let rw = Math.min(w * 0.42, 480);
    const ar = m.pitchH / m.pitchW;
    let rh = rw * ar;
    if (rh > 150) {
      rh = 150;
      rw = rh / ar;
    }
    if (rw !== this.radarW || rh !== this.radarH) {
      this.radarW = rw;
      this.radarH = rh;
      const bg = this.radarBg;
      bg.clear();
      bg.roundRect(0, 0, rw, rh, 8).fill({ color: 0x0a0e14, alpha: 0.72 });
      bg.roundRect(0, 0, rw, rh, 8).stroke({ width: 1.5, color: 0x9be7a8, alpha: 0.5 });
      bg.moveTo(rw / 2, 4).lineTo(rw / 2, rh - 4).stroke({ width: 1, color: 0x9be7a8, alpha: 0.35 });
      bg.circle(rw / 2, rh / 2, 2).fill({ color: 0x9be7a8, alpha: 0.4 });
    }
    this.radarBg.position.set((w - rw) / 2, h - rh - 12);

    const g = this.radarG;
    g.clear();
    const mx = (x: number) => ((x / m.pitchW) + 0.5) * rw;
    const my = (y: number) => ((y / m.pitchH) + 0.5) * rh;
    for (const p of s.players) {
      const def = p.team === 0 ? home : away;
      const r = p.id === s.controlled ? 4 : 3;
      g.circle(mx(p.x), my(p.y), r).fill(def.color).stroke({ width: 1, color: 0x0a0e14 });
      if (p.id === s.controlled) {
        g.circle(mx(p.x), my(p.y), 6).stroke({ width: 1.5, color: 0xffe082 });
      }
    }
    g.circle(mx(s.ball.x), my(s.ball.y), 2.6).fill(0xffffff).stroke({ width: 1, color: 0x000000 });
    this.radarG.position.copyFrom(this.radarBg.position);
  }

  private drawGauge(): void {
    const s = this.state;
    const g = this.gaugeG;
    const hold = Math.max(s.hold.pass, s.hold.through, s.hold.lob, s.hold.shoot);
    const p = s.players[s.controlled];
    g.clear();
    if (hold < 0.02 || !p) return;
    const x = p.x - 0.9;
    const y = p.y - 1.6;
    g.rect(x, y, 1.8, 0.24).fill({ color: 0x000000, alpha: 0.45 });
    const col = hold > 0.85 ? 0xff5252 : 0xffe082;
    g.rect(x + 0.04, y + 0.04, Math.max(0.02, (1.72 * hold)), 0.16).fill(col);
  }
}

function shade(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + c * amount)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
