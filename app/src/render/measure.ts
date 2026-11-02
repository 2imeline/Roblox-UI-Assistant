// DOM text measurement for TextBounds, AutomaticSize and TextScaled.
import type { Font } from '../core/values';
import { cssFamily } from './fonts';
import { buildText } from './richtext';

export interface TextSpec { text: string; rich: boolean; face: Font; size: number; lineHeight: number }

export class TextMeasurer {
  private el: HTMLDivElement;
  private cache = new Map<string, { w: number; h: number }>();
  private fits = new Map<string, number>();

  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, { position: 'absolute', left: '-100000px', top: '0', visibility: 'hidden', fontSynthesis: 'none', contain: 'layout style' });
    document.body.appendChild(this.el);
  }

  measure(s: TextSpec, wrapWidth: number | null): { w: number; h: number } {
    const key = `${s.text}\0${s.rich}\0${s.face.family}\0${s.face.weight}\0${s.face.style}\0${s.size}\0${s.lineHeight}\0${wrapWidth}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const st = this.el.style;
    st.fontFamily = cssFamily(s.face);
    st.fontWeight = String(s.face.weight);
    st.fontStyle = s.face.style === 'Italic' ? 'italic' : 'normal';
    st.fontSize = `${s.size}px`;
    st.lineHeight = `${s.size * s.lineHeight}px`;
    st.whiteSpace = wrapWidth === null ? 'pre' : 'pre-wrap';
    st.overflowWrap = 'anywhere';
    st.width = wrapWidth === null ? 'max-content' : `${Math.max(0, wrapWidth)}px`;
    buildText(this.el, s.text, s.rich);
    let w: number;
    if (wrapWidth === null) w = this.el.getBoundingClientRect().width;
    else {
      // Width of the longest wrapped line, not the box.
      const range = document.createRange();
      range.selectNodeContents(this.el);
      w = Math.min(wrapWidth, range.getBoundingClientRect().width);
    }
    const r = { w, h: s.text === '' ? s.size * s.lineHeight : this.el.getBoundingClientRect().height };
    if (this.cache.size > 4000) this.cache.clear();
    this.cache.set(key, r);
    return r;
  }

  /** TextScaled: the largest integer size (<= max) that fits the box. */
  fit(s: TextSpec, w: number, h: number, wrapped: boolean, min = 1, max = 100): number {
    const key = `${s.text}\0${s.rich}\0${s.face.family}\0${s.face.weight}\0${s.lineHeight}\0${w}\0${h}\0${wrapped}\0${min}\0${max}`;
    const hit = this.fits.get(key);
    if (hit !== undefined) return hit;
    let lo = Math.max(1, Math.floor(min)), hi = Math.max(lo, Math.floor(max));
    const ok = (size: number) => {
      const m = this.measure({ ...s, size }, wrapped ? w : null);
      return m.w <= w + 0.5 && m.h <= h + 0.5;
    };
    if (!ok(lo)) hi = lo;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ok(mid)) lo = mid;
      else hi = mid - 1;
    }
    if (this.fits.size > 4000) this.fits.clear();
    this.fits.set(key, lo);
    return lo;
  }

  clear() { this.cache.clear(); this.fits.clear(); }
  destroy() { this.el.remove(); }
}
