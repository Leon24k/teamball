// Fixed-timestep game loop with render interpolation.

export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  constructor(
    private readonly fixedDt: number,
    private readonly onTick: (dt: number) => void,
    private readonly onFrame: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      let elapsed = (now - this.last) / 1000;
      this.last = now;
      if (elapsed > 0.25) elapsed = 0.25; // clamp big pauses (tab switch)
      this.acc += elapsed;
      let steps = 0;
      while (this.acc >= this.fixedDt && steps < 6) {
        this.onTick(this.fixedDt);
        this.acc -= this.fixedDt;
        steps++;
      }
      if (steps === 6) this.acc = 0; // fell too far behind: drop time
      this.onFrame(this.acc / this.fixedDt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
