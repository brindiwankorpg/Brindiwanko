/**
 * @file Weather drawn over the map: rain, storm (heavier rain, darker sky and
 * lightning now and then) and snow. The power (1–9) sets how many drops or
 * flakes fall; a change of weather or power is reached gradually. Everything
 * is drawn with simple shapes (no image), in screen pixels before the zoom.
 */
import type { WeatherType } from '../../shared/events.js';

/** One drop or flake. */
interface Particle {
  x: number;
  y: number;
  speed: number;
  size: number;
  drift: number;
}

/** The weather of the screen. */
export class Weather {
  private type: WeatherType = 'none';
  /** Power drawn now (eases towards the target). */
  private power = 0;
  private target = 0;
  /** Power change per frame. */
  private step = 0;
  private particles: Particle[] = [];
  private flash = 0;

  /**
   * Changes the weather.
   * @param ms - Time to reach the new power (0: at once).
   */
  set(type: WeatherType, power: number, ms: number): void {
    const frames = Math.max(1, Math.round((ms / 1000) * 60));
    if (type !== this.type && this.type !== 'none' && type !== 'none') {
      // Another kind of weather: the old one goes at once, the new one comes gradually.
      this.particles = [];
      this.power = 0;
    }
    if (type !== 'none') this.type = type;
    this.target = type === 'none' ? 0 : power;
    this.step = Math.abs(this.target - this.power) / frames || 1;
    if (ms <= 0) this.power = this.target;
  }

  /** No weather at all (reconnection). */
  clear(): void {
    this.type = 'none';
    this.power = this.target = 0;
    this.particles = [];
  }

  /** Advances one frame. */
  update(width: number, height: number): void {
    if (this.power < this.target) this.power = Math.min(this.target, this.power + this.step);
    else if (this.power > this.target) this.power = Math.max(this.target, this.power - this.step);
    if (this.power <= 0 && this.target === 0) {
      this.type = 'none';
      this.particles = [];
      return;
    }
    const wanted = Math.round(this.power * (this.type === 'storm' ? 22 : this.type === 'snow' ? 14 : 12));
    while (this.particles.length < wanted) this.particles.push(this.spawn(width, height, true));
    if (this.particles.length > wanted) this.particles.length = wanted;
    for (const p of this.particles) {
      p.y += p.speed;
      p.x += p.drift + (this.type === 'snow' ? Math.sin((p.y + p.size * 40) / 30) * 0.4 : 0);
      if (p.y > height + 10 || p.x < -20 || p.x > width + 20) Object.assign(p, this.spawn(width, height, false));
    }
    if (this.type === 'storm' && this.power >= 4 && Math.random() < 0.002 * this.power) this.flash = 10;
    if (this.flash > 0) this.flash--;
  }

  private spawn(width: number, height: number, anywhere: boolean): Particle {
    const snow = this.type === 'snow';
    return {
      x: Math.random() * (width + 40) - 20,
      y: anywhere ? Math.random() * height : -10,
      speed: snow ? 0.6 + Math.random() * 1.2 : 7 + Math.random() * 5,
      size: snow ? 1.5 + Math.random() * 2 : 8 + Math.random() * 8,
      drift: snow ? Math.random() * 0.6 - 0.3 : -1.5,
    };
  }

  /** Draws the weather over the map. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.type === 'none' || this.power <= 0) return;
    ctx.save();
    if (this.type === 'storm') {
      ctx.fillStyle = `rgba(10, 15, 35, ${Math.min(0.35, this.power * 0.04)})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (this.type === 'snow') {
      // Every flake in one path, filled once (not one path and one fill per flake).
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      for (const p of this.particles) {
        ctx.moveTo(p.x + p.size, p.y);
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      }
      ctx.fill();
    } else {
      ctx.strokeStyle = this.type === 'storm' ? 'rgba(200, 215, 255, 0.55)' : 'rgba(190, 210, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const p of this.particles) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.drift * 2, p.y + p.size);
      }
      ctx.stroke();
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${this.flash / 20})`;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }
}
