// TweenService easing and playback, applied directly to the JS instance tree.
import type { Inst } from '../core/instance';
import { type Value, en, lerp } from '../core/values';

const PI = Math.PI;
const bounceOut = (t: number) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
const IN: Record<string, (t: number) => number> = {
  Linear: (t) => t,
  Sine: (t) => 1 - Math.cos((t * PI) / 2),
  Quad: (t) => t * t,
  Cubic: (t) => t * t * t,
  Quart: (t) => t ** 4,
  Quint: (t) => t ** 5,
  Exponential: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  Circular: (t) => 1 - Math.sqrt(1 - t * t),
  Back: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  Elastic: (t) => (t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * PI) / 3))),
  Bounce: (t) => 1 - bounceOut(1 - t),
};

export function ease(alpha: number, style: string, dir: string): number {
  const t = Math.min(1, Math.max(0, alpha));
  const f = IN[style] ?? IN.Quad;
  if (dir === 'In') return f(t);
  if (dir === 'InOut') return t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2;
  return 1 - f(1 - t);
}

export interface TweenSpec { time: number; style: string; dir: string; repeat: number; reverses: boolean; delay: number }

interface Active {
  tween: Inst;
  target: Inst;
  spec: TweenSpec;
  goals: Map<string, Value>;
  starts: Map<string, Value>;
  elapsed: number;
  state: 'Begin' | 'Delayed' | 'Playing' | 'Paused' | 'Completed' | 'Cancelled';
}

export class TweenEngine {
  private tweens = new Map<Inst, Active>();
  private playing = new Set<Active>();

  constructor(private onDone: (tween: Inst, state: 'Completed' | 'Cancelled') => void) {}

  create(tween: Inst, target: Inst, spec: TweenSpec, goals: Map<string, Value>) {
    this.tweens.set(tween, { tween, target, spec, goals, starts: new Map(), elapsed: 0, state: 'Begin' });
  }

  get busy() { return this.playing.size > 0; }

  play(tween: Inst) {
    const a = this.tweens.get(tween);
    if (!a || a.state === 'Playing' || a.state === 'Delayed') return;
    if (a.state !== 'Paused') {
      a.elapsed = 0;
      a.starts = new Map([...a.goals.keys()].map((k) => [k, a.target.get(k) ?? null]));
    }
    // A newer tween takes over shared properties of older ones on the same instance.
    for (const other of this.playing) {
      if (other === a || other.target !== a.target) continue;
      for (const k of a.goals.keys()) other.goals.delete(k);
      if (!other.goals.size) this.finish(other, 'Cancelled');
    }
    this.setState(a, a.spec.delay > 0 && a.elapsed < a.spec.delay ? 'Delayed' : 'Playing');
    this.playing.add(a);
  }

  pause(tween: Inst) {
    const a = this.tweens.get(tween);
    if (a && this.playing.has(a)) { this.playing.delete(a); this.setState(a, 'Paused'); }
  }

  cancel(tween: Inst) {
    const a = this.tweens.get(tween);
    if (a && a.state !== 'Cancelled' && a.state !== 'Completed' && a.state !== 'Begin') { a.elapsed = 0; this.finish(a, 'Cancelled'); }
  }

  step(dt: number) {
    for (const a of [...this.playing]) {
      a.elapsed += dt;
      const { time, delay, repeat, reverses } = a.spec;
      let t = a.elapsed - delay;
      if (t < 0) continue;
      if (a.state === 'Delayed') {
        a.starts = new Map([...a.goals.keys()].map((k) => [k, a.target.get(k) ?? null]));
        this.setState(a, 'Playing');
      }
      const cycle = time * (reverses ? 2 : 1);
      const total = repeat < 0 ? Infinity : cycle * (repeat + 1);
      const done = t >= total;
      if (done) t = total;
      let local = cycle > 0 ? t % cycle : 0;
      if (done && cycle > 0) local = cycle;
      let alpha = time > 0 ? Math.min(local, time) / time : 1;
      if (reverses && local > time) alpha = 1 - (local - time) / time;
      const k = ease(alpha, a.spec.style, a.spec.dir);
      if (a.target.destroyed) { this.finish(a, 'Cancelled'); continue; }
      for (const [key, goal] of a.goals) {
        const start = a.starts.get(key) ?? goal;
        a.target.set(key, done && !reverses ? goal : lerp(start, goal, k));
      }
      if (done) this.finish(a, 'Completed');
    }
  }

  stateOf(tween: Inst) { return this.tweens.get(tween)?.state ?? 'Begin'; }

  private setState(a: Active, s: Active['state']) {
    a.state = s;
    a.tween.set('PlaybackState', en('PlaybackState', s));
  }

  private finish(a: Active, s: 'Completed' | 'Cancelled') {
    this.playing.delete(a);
    this.setState(a, s);
    this.onDone(a.tween, s);
  }
}
