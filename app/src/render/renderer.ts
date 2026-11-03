// Renders ScreenGuis as positioned DOM elements. Layout comes from core/layout.ts; this file only paints.
// Each GuiObject is one container <div> (geometry, clipping, z-order) holding layer divs for background,
// image and text, followed by its children, so CSS stacking matches ZIndexBehavior.Sibling.
import { isButton, isGuiObject, isImageObject, isTextObject } from '../core/classes';
import type { Inst, World } from '../core/instance';
import { type LayoutEnv, layoutScreenGui, padding } from '../core/layout';
import {
  type Color3, type ColorSequence, type EnumItem, type Font, type NumberSequence, type Rect, type UDim, type UDim2, type Vector2,
  cssColor, sampleColor, sampleNumber, toByte,
} from '../core/values';
import { imageUrl, naturalSize } from './assets';
import { cssFamily } from './fonts';
import type { TextMeasurer, TextSpec } from './measure';
import { buildText } from './richtext';

export interface RenderEnv { viewport: { w: number; h: number }; topInset: number; safe: { l: number; t: number; r: number; b: number } }

export interface RendererOptions {
  mode: 'edit' | 'play';
  measurer: TextMeasurer;
  roots: () => Inst[];
  requestFrame: () => void;
  visual?: (inst: Inst) => 'hover' | 'press' | null;
  afterLayout?: () => void;
  onScroll?: (inst: Inst, x: number, y: number) => void;
  onTextFocus?: (inst: Inst, focused: boolean, enter: boolean) => void;
  onTextInput?: (inst: Inst, text: string) => void;
}

interface Node {
  inst: Inst;
  el: HTMLDivElement;
  kids: HTMLDivElement;
  bg?: HTMLDivElement;
  img?: HTMLDivElement;
  txt?: HTMLDivElement;
  span?: HTMLElement;
  input?: HTMLInputElement | HTMLTextAreaElement;
  scroller?: HTMLDivElement;
  vbar?: HTMLDivElement;
  hbar?: HTMLDivElement;
  children: Node[];
  css: string;
  paintKey: string;
  textKey: string;
  canvasApplied: string;
  enter?: boolean;
}

const MODIFIERS = new Set(['UICorner', 'UIStroke', 'UIGradient', 'UIPadding', 'UIScale', 'UITextSizeConstraint', 'UIListLayout', 'UIGridLayout', 'UIAspectRatioConstraint', 'UISizeConstraint']);
const n = (x: number) => +x.toFixed(3);
const en = (v: unknown) => (v as EnumItem | undefined)?.n;
const first = (inst: Inst, cls: string) => inst.children.find((c) => c.className === cls && c.get('Enabled') !== false);
const mul = (c: Color3, k: number): Color3 => ({ t: 'Color3', r: c.r * k, g: c.g * k, b: c.b * k });
const hex = (c: Color3) => [c.r, c.g, c.b].map((x) => toByte(x).toString(16).padStart(2, '0')).join('');

let tintDefs: SVGDefsElement | null = null;
function tintFilter(c: Color3): string {
  const id = `rbxtint-${hex(c)}`;
  if (id === 'rbxtint-ffffff') return '';
  if (!tintDefs) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    tintDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(tintDefs);
    document.body.appendChild(svg);
  }
  if (!document.getElementById(id)) {
    // Tweened tints make a new color every frame: drop the filters no element uses any more.
    if (tintDefs.childElementCount >= 512) {
      const used = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>('[style*="rbxtint-"]')) for (const m of el.style.cssText.matchAll(/rbxtint-[0-9a-f]{6}/g)) used.add(m[0]);
      for (const f of [...tintDefs.children]) if (!used.has(f.id)) f.remove();
    }
    const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.id = id;
    f.setAttribute('color-interpolation-filters', 'sRGB');
    const m = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', `${c.r} 0 0 0 0 0 ${c.g} 0 0 0 0 0 ${c.b} 0 0 0 0 0 1 0`);
    f.appendChild(m);
    tintDefs.appendChild(f);
  }
  return `url(#${id})`;
}

/** UIGradient as a CSS linear-gradient. Roblox evaluates gradients in the object's UV space; stops are remapped onto the CSS gradient line. */
export function gradientCss(g: Inst, base: Color3, baseT: number, w: number, h: number, alphaOnly = false): string {
  const cs = g.get('Color') as ColorSequence, ts = g.get('Transparency') as NumberSequence;
  const rot = ((Number(g.get('Rotation')) || 0) * Math.PI) / 180;
  const off = g.get('Offset') as Vector2;
  const gx = Math.cos(rot) / Math.max(w, 1e-6), gy = Math.sin(rot) / Math.max(h, 1e-6);
  const phi = Math.atan2(gx, -gy);
  const L = Math.abs(w * Math.sin(phi)) + Math.abs(h * Math.cos(phi));
  const k = L * Math.hypot(gx, gy) || 1;
  const shift = off.x * Math.cos(rot) + off.y * Math.sin(rot);
  const times = [...new Set([...cs.k.map((p) => p.time), ...ts.k.map((p) => p.time)])].sort((a, b) => a - b);
  const stops = times.map((t) => {
    const c = sampleColor(cs, t);
    const alpha = (1 - baseT) * (1 - sampleNumber(ts, t));
    const col = alphaOnly ? `rgba(0,0,0,${n(alpha)})` : cssColor({ t: 'Color3', r: c.r * base.r, g: c.g * base.g, b: c.b * base.b }, 1 - alpha);
    return `${col} ${n((0.5 + (t + shift - 0.5) / k) * 100)}%`;
  });
  return `linear-gradient(${n((phi * 180) / Math.PI)}deg, ${stops.join(', ')})`;
}

export class Renderer {
  private nodes = new Map<Inst, Node>();
  private rootEls = new Set<HTMLDivElement>();
  private layoutDirty = true;
  private paintDirty = new Set<Inst>();
  private env: RenderEnv = { viewport: { w: 1280, h: 720 }, topInset: 58, safe: { l: 0, t: 0, r: 0, b: 0 } };
  private offWorld: (() => void) | null = null;
  private world: World | null = null;
  private onFonts = () => { this.opts.measurer.clear(); this.invalidateAll(); };

  constructor(private surface: HTMLElement, private opts: RendererOptions) {
    document.fonts?.addEventListener?.('loadingdone', this.onFonts);
    window.addEventListener('rbx-assets-reset', this.onFonts);
  }

  setEnv(env: RenderEnv) { this.env = env; this.invalidateAll(); }

  invalidateAll() {
    this.layoutDirty = true;
    for (const n of this.nodes.values()) { n.paintKey = ''; n.textKey = ''; this.paintDirty.add(n.inst); }
    this.opts.requestFrame();
  }

  repaint(inst: Inst) { this.paintDirty.add(inst); this.opts.requestFrame(); }

  private watch(world: World) {
    if (this.world === world) return;
    this.offWorld?.();
    this.world = world;
    for (const el of this.rootEls) el.remove();
    this.rootEls.clear();
    this.nodes.clear();
    this.layoutDirty = true;
    this.offWorld = world.on((ev) => {
      const i = ev.inst;
      this.layoutDirty = true;
      if (ev.k === 'destroy') this.drop(i);
      else {
        this.paintDirty.add(i);
        if (MODIFIERS.has(i.className) && i.parent) this.paintDirty.add(i.parent);
        if (ev.k === 'tree' && ev.oldParent) this.paintDirty.add(ev.oldParent);
      }
      this.opts.requestFrame();
    });
  }

  private drop(inst: Inst) {
    const node = this.nodes.get(inst);
    if (!node) return;
    node.el.remove();
    this.nodes.delete(inst);
  }

  /** Synchronous layout if anything changed (scripts read Absolute* through this). */
  layout() {
    if (!this.layoutDirty) return;
    this.layoutDirty = false;
    const env: LayoutEnv = { ...this.env, measureText: (inst, wrap) => this.opts.measurer.measure(this.spec(inst, Number(inst.get('TextSize')) || 14), wrap) };
    for (const r of this.opts.roots()) {
      const sc = first(r, 'UIScale');
      const s = sc ? Math.max(0.01, Number(sc.get('Scale')) || 1) : 1;
      layoutScreenGui(r, { ...env, viewport: { w: this.env.viewport.w / s, h: this.env.viewport.h / s }, topInset: env.topInset / s, safe: { l: env.safe.l / s, t: env.safe.t / s, r: env.safe.r / s, b: env.safe.b / s } });
    }
    this.opts.afterLayout?.();
  }

  render() {
    const roots = this.opts.roots();
    if (roots[0]) this.watch(roots[0].world);
    this.layout();
    const live = new Set<HTMLDivElement>();
    roots.forEach((r) => {
      const node = this.node(r);
      live.add(node.el);
      if (node.el.parentNode !== this.surface) this.surface.appendChild(node.el);
      const sc = first(r, 'UIScale');
      const s = sc ? Number(sc.get('Scale')) || 1 : 1;
      const css = `left:${n(r.box.x)}px;top:${n(r.box.y)}px;width:${n(r.box.w)}px;height:${n(r.box.h)}px;z-index:${Number(r.get('DisplayOrder')) || 0};` +
        `${r.get('Enabled') === false ? 'display:none;' : ''}${s !== 1 ? `transform:scale(${s});transform-origin:0 0;` : ''}`;
      if (css !== node.css) { node.el.style.cssText = css; node.css = css; }
      this.syncChildren(node);
    });
    for (const el of this.rootEls) if (!live.has(el)) el.remove();
    this.rootEls = live;
    this.paintDirty.clear();
  }

  private node(inst: Inst): Node {
    let node = this.nodes.get(inst);
    if (node) return node;
    const el = document.createElement('div');
    (el as unknown as { __rbx: Inst }).__rbx = inst;
    node = { inst, el, kids: el, children: [], css: '', paintKey: '', textKey: '', canvasApplied: '' };
    const cls = inst.className;
    if (cls === 'ScreenGui') el.className = 'rg-screen';
    else {
      el.className = 'rg';
      node.bg = layer(el, 'rg-bg');
      if (isImageObject(cls)) node.img = layer(el, 'rg-img');
      if (isTextObject(cls)) {
        node.txt = layer(el, 'rg-txt');
        if (cls === 'TextBox') this.makeInput(node);
        else node.span = node.txt.appendChild(document.createElement('span'));
      }
      if (cls === 'ScrollingFrame') {
        node.scroller = layer(el, 'rg-scroll');
        node.kids = layer(node.scroller, 'rg-canvas');
        node.vbar = layer(el, 'rg-bar');
        node.hbar = layer(el, 'rg-bar');
        node.scroller.addEventListener('scroll', () => {
          const s = node!.scroller!;
          node!.canvasApplied = `${s.scrollLeft},${s.scrollTop}`;
          this.bars(node!);
          if (this.opts.mode === 'play') this.opts.onScroll?.(inst, s.scrollLeft, s.scrollTop);
        }, { passive: true });
      }
    }
    this.nodes.set(inst, node);
    return node;
  }

  private makeInput(node: Node) {
    const inst = node.inst;
    const multi = inst.get('MultiLine') === true;
    const input = document.createElement(multi ? 'textarea' : 'input');
    input.className = 'rg-input';
    input.spellcheck = false;
    if (this.opts.mode === 'edit') { input.readOnly = true; input.tabIndex = -1; }
    else {
      input.addEventListener('focus', () => { node.enter = false; this.opts.onTextFocus?.(inst, true, false); });
      input.addEventListener('blur', () => this.opts.onTextFocus?.(inst, false, node.enter === true));
      input.addEventListener('input', () => this.opts.onTextInput?.(inst, input.value));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if ((e as KeyboardEvent).key === 'Enter' && !multi) { node.enter = true; input.blur(); }
      });
      input.addEventListener('keyup', (e) => e.stopPropagation());
    }
    node.input = input;
    node.span = input;
    node.txt!.appendChild(input);
  }

  focusTextBox(inst: Inst, focus: boolean) {
    const input = this.nodes.get(inst)?.input;
    if (!input) return;
    if (focus) input.focus();
    else input.blur();
  }

  private syncChildren(node: Node) {
    const kids: Node[] = [];
    for (const c of node.inst.children) if (isGuiObject(c.className)) kids.push(this.node(c));
    const same = kids.length === node.children.length && kids.every((k, i) => k === node.children[i]);
    if (!same) {
      for (const old of node.children) if (!kids.includes(old) && old.el.parentNode === node.kids) old.el.remove();
      for (const k of kids) node.kids.appendChild(k.el);
      node.children = kids;
    }
    for (const k of kids) this.update(k);
  }

  private update(node: Node) {
    const i = node.inst;
    const b = i.box;
    const l = Math.round(b.x), t = Math.round(b.y);
    const w = Math.round(b.x + b.w) - l, h = Math.round(b.y + b.h) - t;
    const rot = Number(i.get('Rotation')) || 0;
    const sc = first(i, 'UIScale');
    const s = sc ? Number(sc.get('Scale')) || 1 : 1;
    let transform = '';
    if (rot || s !== 1) {
      const a = i.get('AnchorPoint') as Vector2;
      const tx = (a.x - 0.5) * w * (1 - s), ty = (a.y - 0.5) * h * (1 - s);
      transform = `transform:${tx || ty ? `translate(${n(tx)}px,${n(ty)}px) ` : ''}${rot ? `rotate(${n(rot)}deg) ` : ''}${s !== 1 ? `scale(${n(s)})` : ''};`;
    }
    let css = `left:${l}px;top:${t}px;width:${w}px;height:${h}px;z-index:${(Number(i.get('ZIndex')) || 0) + 100000};${transform}`;
    if (i.get('Visible') === false) css += 'display:none;';
    if (i.get('ClipsDescendants') === true && i.className !== 'ScrollingFrame') css += 'overflow:hidden;';
    if (i.className === 'CanvasGroup') {
      const gt = Number(i.get('GroupTransparency')) || 0;
      css += `overflow:hidden;border-radius:${this.radius(i, w, h)}px;${gt ? `opacity:${n(1 - gt)};` : ''}`;
      const tint = tintFilter(i.get('GroupColor3') as Color3);
      if (tint) css += `filter:${tint};`;
    }
    if (this.opts.mode === 'play' && (i.get('Interactable') === false)) css += 'pointer-events:none;';
    if (css !== node.css) { node.el.style.cssText = css; node.css = css; }
    const key = `${w},${h}`;
    if (this.paintDirty.has(i) || node.paintKey !== key) {
      node.paintKey = key;
      this.paint(node, w, h);
    }
    this.syncChildren(node);
  }

  private radius(i: Inst, w: number, h: number) {
    const c = first(i, 'UICorner');
    if (!c) return 0;
    const r = c.get('CornerRadius') as UDim;
    const m = Math.min(w, h);
    return n(Math.max(0, Math.min(r.s * m + r.o, m / 2)));
  }

  private paint(node: Node, w: number, h: number) {
    const i = node.inst, cls = i.className;
    const radius = this.radius(i, w, h);
    const stroke = first(i, 'UIStroke');
    const gradient = first(i, 'UIGradient');
    const textual = isTextObject(cls);
    const borderStroke = stroke && (!textual || en(stroke.get('ApplyStrokeMode')) === 'Border') ? stroke : undefined;

    // Background, border and border stroke
    let bgColor = i.get('BackgroundColor3') as Color3;
    const bgT = Number(i.get('BackgroundTransparency')) || 0;
    if (this.opts.mode === 'play' && isButton(cls) && i.get('AutoButtonColor') !== false) {
      // Approximates Roblox's AutoButtonColor hover/press shading.
      const st = this.opts.visual?.(i);
      if (st === 'hover') bgColor = mul(bgColor, 0.75);
      if (st === 'press') bgColor = mul(bgColor, 0.55);
    }
    let bg = '';
    if (bgT < 1) bg += gradient ? `background-image:${gradientCss(gradient, bgColor, bgT, w, h)};` : `background-color:${cssColor(bgColor, bgT)};`;
    const border = Number(i.get('BorderSizePixel')) || 0;
    if (border > 0 && !radius && bgT < 1 && cls !== 'ScreenGui') {
      const mode = en(i.get('BorderMode'));
      const out = mode === 'Inset' ? 0 : mode === 'Middle' ? border / 2 : border;
      bg += `inset:${-out}px;border:${border}px solid ${cssColor(i.get('BorderColor3') as Color3, bgT)};`;
    }
    if (radius) bg += `border-radius:${radius}px;`;
    if (borderStroke) {
      const th = Math.max(0, Number(borderStroke.get('Thickness')) || 0);
      const sc = cssColor(borderStroke.get('Color') as Color3, Number(borderStroke.get('Transparency')) || 0);
      const pos = en(borderStroke.get('BorderStrokePosition'));
      if (th > 0) bg += `box-shadow:${pos === 'Inner' ? `inset 0 0 0 ${th}px ${sc}` : pos === 'Center' ? `0 0 0 ${th / 2}px ${sc}, inset 0 0 0 ${th / 2}px ${sc}` : `0 0 0 ${th}px ${sc}`};`;
      if (radius) bg += `border-radius:${radius}px;`;
    }
    if (!bg) bg = 'display:none;';
    if (node.bg && node.bg.style.cssText !== bg) node.bg.style.cssText = bg;

    if (node.img) this.paintImage(node, w, h, radius, gradient);
    if (node.txt) this.paintText(node, w, h, stroke && !borderStroke ? stroke : undefined, gradient);
    if (node.scroller) this.paintScroll(node, w, h);
  }

  private paintImage(node: Node, w: number, h: number, radius: number, gradient?: Inst) {
    const i = node.inst;
    let content = String(i.get('Image') ?? '');
    if (this.opts.mode === 'play' && i.className === 'ImageButton') {
      const st = this.opts.visual?.(i);
      if (st === 'press' && i.get('PressedImage')) content = String(i.get('PressedImage'));
      else if (st && i.get('HoverImage')) content = String(i.get('HoverImage'));
    }
    const url = imageUrl(content, () => this.repaint(i));
    const el = node.img!;
    if (!url) {
      el.style.cssText = url === null && content && this.opts.mode === 'edit' ? 'display:block' : 'display:none';
      el.classList.toggle('rg-missing', url === null && !!content && this.opts.mode === 'edit');
      return;
    }
    el.classList.remove('rg-missing');
    const it = Number(i.get('ImageTransparency')) || 0;
    let css = `background-image:url("${url.replace(/"/g, '%22')}");background-repeat:no-repeat;`;
    if (it) css += `opacity:${n(1 - it)};`;
    if (radius) css += `border-radius:${radius}px;`;
    const tint = tintFilter(i.get('ImageColor3') as Color3);
    if (tint) css += `filter:${tint};`;
    if (en(i.get('ResampleMode')) === 'Pixelated') css += 'image-rendering:pixelated;';
    if (gradient) css += `-webkit-mask-image:${gradientCss(gradient, { t: 'Color3', r: 1, g: 1, b: 1 }, 0, w, h, true)};mask-image:${gradientCss(gradient, { t: 'Color3', r: 1, g: 1, b: 1 }, 0, w, h, true)};`;
    const mode = en(i.get('ScaleType'));
    const rectSize = i.get('ImageRectSize') as Vector2, rectOff = i.get('ImageRectOffset') as Vector2;
    if (mode === 'Fit') css += 'background-size:contain;background-position:center;';
    else if (mode === 'Crop') css += 'background-size:cover;background-position:center;';
    else if (mode === 'Tile') {
      const ts = i.get('TileSize') as UDim2;
      css += `background-size:${n(ts.xs * w + ts.xo)}px ${n(ts.ys * h + ts.yo)}px;background-repeat:repeat;`;
    } else if (mode === 'Slice') {
      const sc = i.get('SliceCenter') as Rect;
      const nat = naturalSize(url, () => this.repaint(i));
      if (nat && (sc.x1 > sc.x0 || sc.y1 > sc.y0)) {
        const k = Number(i.get('SliceScale')) || 1;
        const [t, r, b, l] = [sc.y0, nat.w - sc.x1, nat.h - sc.y1, sc.x0].map((x) => Math.max(0, x));
        css = css.replace(/background-image:[^;]+;background-repeat:no-repeat;/, '') +
          `border-style:solid;border-color:transparent;border-image-source:url("${url.replace(/"/g, '%22')}");border-image-slice:${t} ${r} ${b} ${l} fill;` +
          `border-width:${n(t * k)}px ${n(r * k)}px ${n(b * k)}px ${n(l * k)}px;border-image-repeat:stretch;`;
      } else css += 'background-size:100% 100%;';
    } else if (rectSize.x > 0 && rectSize.y > 0) {
      const nat = naturalSize(url, () => this.repaint(i));
      if (nat) {
        const sx = w / rectSize.x, sy = h / rectSize.y;
        css += `background-size:${n(nat.w * sx)}px ${n(nat.h * sy)}px;background-position:${n(-rectOff.x * sx)}px ${n(-rectOff.y * sy)}px;`;
      } else css += 'background-size:100% 100%;';
    } else css += 'background-size:100% 100%;';
    if (el.style.cssText !== css) el.style.cssText = css;
  }

  spec(i: Inst, size: number): TextSpec {
    return {
      text: String(i.get('Text') ?? ''),
      rich: i.get('RichText') === true,
      face: i.get('FontFace') as Font,
      size,
      lineHeight: Number(i.get('LineHeight')) || 1,
    };
  }

  private paintText(node: Node, w: number, h: number, stroke?: Inst, gradient?: Inst) {
    const i = node.inst;
    const pad = padding(i, w, h);
    const iw = Math.max(0, w - pad.l - pad.r), ih = Math.max(0, h - pad.t - pad.b);
    const wrapped = i.get('TextWrapped') === true;
    let size = Number(i.get('TextSize')) || 14;
    if (i.get('TextScaled') === true) {
      const c = i.children.find((x) => x.className === 'UITextSizeConstraint');
      size = this.opts.measurer.fit(this.spec(i, size), iw, ih, wrapped, c ? Number(c.get('MinTextSize')) : 1, c ? Math.min(100, Number(c.get('MaxTextSize'))) : 100);
    }
    const face = i.get('FontFace') as Font;
    const lh = Number(i.get('LineHeight')) || 1;
    const xa = en(i.get('TextXAlignment')), ya = en(i.get('TextYAlignment'));
    const tt = Number(i.get('TextTransparency')) || 0;
    const color = i.get('TextColor3') as Color3;
    const txt = node.txt!;
    const tcss = `left:${n(pad.l)}px;top:${n(pad.t)}px;width:${n(iw)}px;height:${n(ih)}px;` +
      `align-items:${ya === 'Top' ? 'flex-start' : ya === 'Bottom' ? 'flex-end' : 'center'};` +
      `justify-content:${xa === 'Left' ? 'flex-start' : xa === 'Right' ? 'flex-end' : 'center'};`;
    if (txt.style.cssText !== tcss) txt.style.cssText = tcss;

    let css = `font-family:${cssFamily(face)};font-weight:${face.weight};font-style:${face.style === 'Italic' ? 'italic' : 'normal'};` +
      `font-size:${size}px;line-height:${n(size * lh)}px;text-align:${xa === 'Left' ? 'left' : xa === 'Right' ? 'right' : 'center'};` +
      `white-space:${wrapped ? 'pre-wrap' : 'pre'};${wrapped ? 'width:100%;overflow-wrap:anywhere;' : ''}`;
    if (gradient && tt < 1) css += `background-image:${gradientCss(gradient, color, tt, iw, ih)};-webkit-background-clip:text;background-clip:text;color:transparent;`;
    else css += `color:${cssColor(color, tt)};`;
    const sT = Number(i.get('TextStrokeTransparency'));
    if (stroke && Number(stroke.get('Thickness')) > 0) {
      css += `-webkit-text-stroke:${n(Number(stroke.get('Thickness')) * 2)}px ${cssColor(stroke.get('Color') as Color3, Math.max(tt, Number(stroke.get('Transparency')) || 0))};paint-order:stroke fill;`;
    } else if (sT < 1) {
      css += `-webkit-text-stroke:2px ${cssColor(i.get('TextStrokeColor3') as Color3, Math.max(sT, tt))};paint-order:stroke fill;`;
    }
    if (en(i.get('TextTruncate')) === 'AtEnd' || en(i.get('TextTruncate')) === 'SplitWord') {
      if (wrapped) css += `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${Math.max(1, Math.floor(ih / (size * lh) + 0.01))};overflow:hidden;`;
      else css += 'overflow:hidden;text-overflow:ellipsis;max-width:100%;';
    }
    const input = node.input;
    if (input) {
      const text = String(i.get('Text') ?? '');
      css += `caret-color:${cssColor(color)};--ph:${cssColor(i.get('PlaceholderColor3') as Color3)};` +
        (input.tagName === 'TEXTAREA' ? 'width:100%;height:100%;' : `width:100%;height:${n(size * lh)}px;`) +
        (this.opts.mode === 'play' ? 'pointer-events:auto;' : '');
      if (input.style.cssText !== css) input.style.cssText = css;
      if (input.value !== text) input.value = text;
      const ph = String(i.get('PlaceholderText') ?? '');
      if (input.placeholder !== ph) input.placeholder = ph;
      if (this.opts.mode === 'play') input.readOnly = i.get('TextEditable') === false;
      return;
    }
    const span = node.span!;
    if (span.style.cssText !== css) span.style.cssText = css;
    const text = String(i.get('Text') ?? '');
    const rich = i.get('RichText') === true;
    const maxG = Number(i.get('MaxVisibleGraphemes'));
    const key = `${rich}\0${maxG}\0${text}`;
    if (node.textKey !== key) { node.textKey = key; buildText(span, text, rich, maxG); }
  }

  private paintScroll(node: Node, w: number, h: number) {
    const i = node.inst;
    const cw = Math.max(w, i.contentSize.x), ch = Math.max(h, i.contentSize.y);
    const dir = en(i.get('ScrollingDirection'));
    const enabled = i.get('ScrollingEnabled') !== false;
    const sx = enabled && dir !== 'Y' && cw > w + 0.5, sy = enabled && dir !== 'X' && ch > h + 0.5;
    node.scroller!.style.cssText = `overflow-x:${sx ? 'scroll' : 'hidden'};overflow-y:${sy ? 'scroll' : 'hidden'};`;
    node.kids.style.cssText = `width:${n(cw)}px;height:${n(ch)}px;`;
    const cp = i.get('CanvasPosition') as Vector2;
    const want = `${Math.round(cp.x)},${Math.round(cp.y)}`;
    if (want !== node.canvasApplied) {
      node.canvasApplied = want;
      node.scroller!.scrollTo(cp.x, cp.y);
    }
    this.bars(node);
  }

  private bars(node: Node) {
    const i = node.inst, s = node.scroller!;
    const w = s.clientWidth, h = s.clientHeight;
    const cw = s.scrollWidth, ch = s.scrollHeight;
    const th = Math.max(0, Number(i.get('ScrollBarThickness')) || 0);
    const color = cssColor(i.get('ScrollBarImageColor3') as Color3, Number(i.get('ScrollBarImageTransparency')) || 0);
    const left = en(i.get('VerticalScrollBarPosition')) === 'Left';
    const vis = i.get('ScrollingEnabled') !== false && th > 0;
    node.vbar!.style.cssText = vis && ch > h + 0.5
      ? `z-index:2147483000;${left ? 'left' : 'right'}:0;width:${th}px;top:${n((s.scrollTop / ch) * h)}px;height:${n((h * h) / ch)}px;background:${color};`
      : 'display:none;';
    node.hbar!.style.cssText = vis && cw > w + 0.5
      ? `z-index:2147483000;bottom:0;height:${th}px;left:${n((s.scrollLeft / cw) * w)}px;width:${n((w * w) / cw)}px;background:${color};`
      : 'display:none;';
  }

  /** GuiObjects under a client point, topmost first. */
  hitTest(clientX: number, clientY: number): Inst[] {
    const out: Inst[] = [];
    for (const e of document.elementsFromPoint(clientX, clientY)) {
      const inst = (e as unknown as { __rbx?: Inst }).__rbx;
      if (inst && inst.className !== 'ScreenGui' && this.nodes.get(inst)?.el === e && !out.includes(inst)) out.push(inst);
    }
    return out;
  }

  /** Unrotated rect of an instance in device pixels, following live scroll offsets. */
  rectOf(inst: Inst): { x: number; y: number; w: number; h: number } {
    let x = 0, y = 0;
    for (let p: Inst | null = inst; p; p = p.parent) {
      x += p.box.x;
      y += p.box.y;
      if (p.className === 'ScreenGui') break;
      const s = p.parent && this.nodes.get(p.parent)?.scroller;
      if (s) { x -= s.scrollLeft; y -= s.scrollTop; }
    }
    return { x, y, w: inst.box.w, h: inst.box.h };
  }

  element(inst: Inst) { return this.nodes.get(inst)?.el; }

  destroy() {
    this.offWorld?.();
    document.fonts?.removeEventListener?.('loadingdone', this.onFonts);
    window.removeEventListener('rbx-assets-reset', this.onFonts);
    for (const el of this.rootEls) el.remove();
    this.nodes.clear();
  }
}

function layer(parent: HTMLElement, cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
}
