// Owns the renderer, the optional play-mode runtime and the frame loop for the canvas.
import type { Inst } from '../core/instance';
import { TextMeasurer } from '../render/measure';
import { Renderer } from '../render/renderer';
import type { Runtime } from '../runtime/runtime';
import { type Device, TOPBAR, store } from './store';

export class Engine {
  readonly measurer = new TextMeasurer();
  renderer: Renderer;
  runtime: Runtime | null = null;
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Infinity;
  private disposed = false;
  /** Bumped on every mode switch so a play() still loading can tell it was cancelled. */
  private session = 0;

  constructor(private surface: HTMLElement, private device: Device) {
    this.renderer = this.makeRenderer('edit');
  }

  private makeRenderer(mode: 'edit' | 'play') {
    const r = new Renderer(this.surface, {
      mode,
      measurer: this.measurer,
      roots: mode === 'edit'
        ? () => [store.root]
        : () => this.runtime?.playerGui.children.filter((c) => c.className === 'ScreenGui') ?? [],
      requestFrame: () => this.request(0),
      visual: (i) => this.runtime?.visualState(i) ?? null,
      afterLayout: () => this.runtime?.afterLayout(),
      onScroll: (i, x, y) => this.runtime?.scrolled(i, x, y),
      onTextFocus: (i, f, enter) => this.runtime?.textFocus(i, f, enter),
      onTextInput: (i, t) => this.runtime?.textInput(i, t),
    });
    r.setEnv(this.env());
    return r;
  }

  private env() {
    return { viewport: { w: this.device.w, h: this.device.h }, topInset: TOPBAR, safe: this.device.safe };
  }

  setDevice(d: Device) {
    this.device = d;
    this.renderer.setEnv(this.env());
    this.runtime?.setViewport();
  }

  /** Schedules a frame now (ms = 0) or after a delay. */
  request(ms: number) {
    if (this.disposed) return;
    if (ms <= 4) {
      if (!this.raf) this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const at = performance.now() + ms;
    if (this.timer && at >= this.timerAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => { this.timer = null; this.timerAt = Infinity; this.request(0); }, ms);
  }

  private frame = (t: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const next = this.runtime ? this.runtime.step(t) : -1;
    this.renderer.render();
    if (next >= 0) this.request(next);
  };

  async play(doc: Inst) {
    const session = ++this.session;
    this.stopRuntime();
    this.renderer.destroy();
    this.renderer = this.makeRenderer('play');
    const { Runtime } = await import('../runtime/runtime');
    const rt = await Runtime.create([doc], {
      log: (k, m, tr) => store.log(k, m, tr),
      ensureLayout: () => this.renderer.layout(),
      measureText: (text, size, face, wrap) => this.measurer.measure({ text, rich: false, face, size, lineHeight: 1 }, wrap),
      requestStep: (ms) => this.request(ms),
      focusTextBox: (i, f) => this.renderer.focusTextBox(i, f),
      visualChanged: (i) => this.renderer.repaint(i),
      viewport: () => ({ w: this.device.w, h: this.device.h }),
      topInset: TOPBAR,
      touch: this.device.touch,
    });
    if (this.disposed || session !== this.session) { rt.stop(); return; }
    this.runtime = rt;
    store.setLive(rt.playerGui);
    this.renderer.render();
    rt.start();
    this.request(0);
  }

  edit() {
    this.session++;
    this.stopRuntime();
    store.setLive(null);
    this.renderer.destroy();
    this.renderer = this.makeRenderer('edit');
    this.request(0);
  }

  private stopRuntime() {
    this.runtime?.stop();
    this.runtime = null;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.timer) clearTimeout(this.timer);
    this.stopRuntime();
    this.renderer.destroy();
    this.measurer.destroy();
  }
}
