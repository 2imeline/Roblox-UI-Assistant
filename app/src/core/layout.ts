// Roblox 2D layout: UDim2 position/size, AnchorPoint, SizeConstraint, AutomaticSize, UIPadding,
// UIListLayout, UIGridLayout, UIAspectRatioConstraint, UISizeConstraint, ScrollingFrame canvases.
// Writes Inst.box (relative to the parent's top-left, or its canvas) and Inst.contentSize.
import { isGuiObject, isTextObject } from './classes';
import type { Inst } from './instance';
import type { EnumItem, UDim, UDim2, Vector2 } from './values';

export interface LayoutEnv {
  viewport: { w: number; h: number };
  /** Height of the Roblox topbar for ScreenGuis with IgnoreGuiInset = false. */
  topInset: number;
  /** Device safe-area insets (notches), applied unless ScreenInsets is None. */
  safe: { l: number; t: number; r: number; b: number };
  /** Text size in px for a text object at its current TextSize; wrapWidth null = no wrapping. */
  measureText(inst: Inst, wrapWidth: number | null): { w: number; h: number };
}

type Ext = { w: number; h: number };

const enumName = (v: unknown) => (v as EnumItem | undefined)?.n;
const firstChild = (inst: Inst, cls: string) => inst.children.find((c) => c.className === cls);
const isLayout = (c: Inst) => c.className === 'UIListLayout' || c.className === 'UIGridLayout';

export function padding(inst: Inst, w: number, h: number) {
  const p = firstChild(inst, 'UIPadding');
  if (!p) return { l: 0, r: 0, t: 0, b: 0 };
  const u = (k: string, ref: number) => { const d = p.get(k) as UDim; return d.s * ref + d.o; };
  return { l: u('PaddingLeft', w), r: u('PaddingRight', w), t: u('PaddingTop', h), b: u('PaddingBottom', h) };
}

export function layoutScreenGui(sg: Inst, env: LayoutEnv) {
  const insets = enumName(sg.get('ScreenInsets')) !== 'None';
  const top = Math.max(sg.get('IgnoreGuiInset') ? 0 : env.topInset, insets ? env.safe.t : 0);
  const l = insets ? env.safe.l : 0, r = insets ? env.safe.r : 0, b = insets ? env.safe.b : 0;
  sg.box = { x: l, y: top, w: Math.max(0, env.viewport.w - l - r), h: Math.max(0, env.viewport.h - top - b) };
  layoutChildren(sg, sg.box.w, sg.box.h, env);
}

/** Lays out the GuiObject children of `node` (size w×h). Returns the content extents for AutomaticSize. */
function layoutChildren(node: Inst, w: number, h: number, env: LayoutEnv): Ext {
  const scrolling = node.className === 'ScrollingFrame';
  let areaW = w, areaH = h;
  if (scrolling) {
    const cs = node.get('CanvasSize') as UDim2;
    // The canvas is never smaller than the window.
    areaW = Math.max(w, cs.xs * w + cs.xo);
    areaH = Math.max(h, cs.ys * h + cs.yo);
  }
  const pad = padding(node, areaW, areaH);
  let ext = place(node, areaW - pad.l - pad.r, areaH - pad.t - pad.b, pad.l, pad.t, env);
  if (scrolling) {
    const auto = enumName(node.get('AutomaticCanvasSize'));
    const needW = ext.w + pad.l + pad.r, needH = ext.h + pad.t + pad.b;
    let cw = areaW, ch = areaH;
    if ((auto === 'X' || auto === 'XY') && needW > cw) cw = needW;
    if ((auto === 'Y' || auto === 'XY') && needH > ch) ch = needH;
    if (cw !== areaW || ch !== areaH) {
      const p2 = padding(node, cw, ch);
      ext = place(node, cw - p2.l - p2.r, ch - p2.t - p2.b, p2.l, p2.t, env);
    }
    node.contentSize = { x: cw, y: ch };
  }
  return ext;
}

function place(node: Inst, cw: number, ch: number, ox: number, oy: number, env: LayoutEnv): Ext {
  const items = node.children.filter((c) => isGuiObject(c.className));
  const layout = node.children.find(isLayout);
  const grid = layout?.className === 'UIGridLayout';
  for (const it of items) if (!grid || it.get('Visible') === false) sizeOf(it, cw, ch, env);
  if (layout) {
    const visible = sortItems(items.filter((i) => i.get('Visible') !== false), layout);
    const ext = layout.className === 'UIListLayout' ? listLayout(layout, visible, cw, ch, ox, oy) : gridLayout(layout, visible, cw, ch, ox, oy, env);
    layout.contentSize = { x: ext.w, y: ext.h };
    for (const it of items) if (it.get('Visible') === false) positionFree(it, cw, ch, ox, oy);
    return ext;
  }
  let ext: Ext = { w: 0, h: 0 };
  for (const it of items) {
    positionFree(it, cw, ch, ox, oy);
    if (it.get('Visible') !== false) ext = { w: Math.max(ext.w, it.box.x - ox + it.box.w), h: Math.max(ext.h, it.box.y - oy + it.box.h) };
  }
  return ext;
}

function positionFree(it: Inst, cw: number, ch: number, ox: number, oy: number) {
  const p = it.get('Position') as UDim2, a = it.get('AnchorPoint') as Vector2;
  it.box.x = ox + p.xs * cw + p.xo - a.x * it.box.w;
  it.box.y = oy + p.ys * ch + p.yo - a.y * it.box.h;
}

/** Computes it.box.w/h from Size, constraints and AutomaticSize, then lays out its subtree. */
function sizeOf(it: Inst, cw: number, ch: number, env: LayoutEnv, forced?: Ext) {
  let w: number, h: number;
  if (forced) ({ w, h } = forced);
  else {
    const s = it.get('Size') as UDim2;
    const sc = enumName(it.get('SizeConstraint'));
    const rw = sc === 'RelativeYY' ? ch : cw, rh = sc === 'RelativeXX' ? cw : ch;
    w = s.xs * rw + s.xo;
    h = s.ys * rh + s.yo;
  }
  ({ w, h } = constrain(it, w, h));
  const auto = enumName(it.get('AutomaticSize'));
  if (auto && auto !== 'None') {
    const pad = padding(it, w, h);
    let content: Ext;
    if (isTextObject(it.className)) {
      const wrap = it.get('TextWrapped') && auto === 'Y' ? Math.max(0, w - pad.l - pad.r) : null;
      content = env.measureText(it, wrap);
    } else content = { w: 0, h: 0 };
    const kids = layoutChildren(it, w, h, env);
    content = { w: Math.max(content.w, kids.w), h: Math.max(content.h, kids.h) };
    if (auto === 'X' || auto === 'XY') w = Math.max(w, content.w + pad.l + pad.r);
    if (auto === 'Y' || auto === 'XY') h = Math.max(h, content.h + pad.t + pad.b);
    ({ w, h } = constrain(it, w, h, true));
  }
  it.box.w = Math.max(0, w);
  it.box.h = Math.max(0, h);
  layoutChildren(it, it.box.w, it.box.h, env);
}

function constrain(it: Inst, w: number, h: number, sizeOnly = false): Ext {
  for (const c of it.children) {
    if (c.className === 'UIAspectRatioConstraint' && !sizeOnly) {
      const r = Number(c.get('AspectRatio')) || 1;
      if (enumName(c.get('AspectType')) === 'ScaleWithParentSize') {
        if (enumName(c.get('DominantAxis')) === 'Height') w = h * r;
        else h = w / r;
      } else if (w / Math.max(h, 1e-9) > r) w = h * r;
      else h = w / r;
    } else if (c.className === 'UISizeConstraint') {
      const mn = c.get('MinSize') as Vector2, mx = c.get('MaxSize') as Vector2;
      w = Math.min(Math.max(w, mn.x), mx.x);
      h = Math.min(Math.max(h, mn.y), mx.y);
    }
  }
  return { w, h };
}

function sortItems(items: Inst[], layout: Inst): Inst[] {
  const byName = enumName(layout.get('SortOrder')) === 'Name';
  const idx = new Map(items.map((it, i) => [it, i]));
  return [...items].sort((a, b) => {
    const d = byName ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : Number(a.get('LayoutOrder')) - Number(b.get('LayoutOrder'));
    return d || idx.get(a)! - idx.get(b)!;
  });
}

const align = (mode: string | undefined, space: number, size: number, start: string, end: string) =>
  mode === start ? 0 : mode === end ? space - size : (space - size) / 2;

function listLayout(layout: Inst, items: Inst[], cw: number, ch: number, ox: number, oy: number): Ext {
  const horizontal = enumName(layout.get('FillDirection')) === 'Horizontal';
  const pad = layout.get('Padding') as UDim;
  const gap = pad.s * (horizontal ? cw : ch) + pad.o;
  const hA = enumName(layout.get('HorizontalAlignment')), vA = enumName(layout.get('VerticalAlignment'));
  const main = (i: Inst) => (horizontal ? i.box.w : i.box.h);
  const cross = (i: Inst) => (horizontal ? i.box.h : i.box.w);
  const limit = horizontal ? cw : ch;
  // Split into lines (a single line unless Wraps is on).
  const lines: Inst[][] = [];
  let line: Inst[] = [], used = 0;
  for (const it of items) {
    if (layout.get('Wraps') && line.length && used + gap + main(it) > limit + 0.01) { lines.push(line); line = []; used = 0; }
    used += (line.length ? gap : 0) + main(it);
    line.push(it);
  }
  if (line.length) lines.push(line);
  const lineMain = lines.map((l) => l.reduce((s, i) => s + main(i), 0) + gap * (l.length - 1));
  const lineCross = lines.map((l) => Math.max(0, ...l.map(cross)));
  const totalMain = Math.max(0, ...lineMain);
  const totalCross = lineCross.reduce((s, c) => s + c, 0) + gap * Math.max(0, lines.length - 1);
  let crossPos = horizontal ? align(vA, ch, totalCross, 'Top', 'Bottom') : align(hA, cw, totalCross, 'Left', 'Right');
  lines.forEach((l, li) => {
    let mainPos = horizontal ? align(hA, cw, lineMain[li], 'Left', 'Right') : align(vA, ch, lineMain[li], 'Top', 'Bottom');
    const lc = lines.length > 1 ? lineCross[li] : horizontal ? ch : cw;
    for (const it of l) {
      const c = horizontal ? align(vA, lc, it.box.h, 'Top', 'Bottom') : align(hA, lc, it.box.w, 'Left', 'Right');
      const base = lines.length > 1 ? crossPos : 0;
      if (horizontal) { it.box.x = ox + mainPos; it.box.y = oy + base + c; }
      else { it.box.y = oy + mainPos; it.box.x = ox + base + c; }
      mainPos += main(it) + gap;
    }
    crossPos += lineCross[li] + gap;
  });
  return horizontal ? { w: totalMain, h: totalCross } : { w: totalCross, h: totalMain };
}

function gridLayout(layout: Inst, items: Inst[], cw: number, ch: number, ox: number, oy: number, env: LayoutEnv): Ext {
  const cs = layout.get('CellSize') as UDim2, cp = layout.get('CellPadding') as UDim2;
  const cellW = cs.xs * cw + cs.xo, cellH = cs.ys * ch + cs.yo;
  const padX = cp.xs * cw + cp.xo, padY = cp.ys * ch + cp.yo;
  const horizontal = enumName(layout.get('FillDirection')) !== 'Vertical';
  const maxCells = Number(layout.get('FillDirectionMaxCells')) || 0;
  const fit = horizontal ? Math.floor((cw + padX) / (cellW + padX)) : Math.floor((ch + padY) / (cellH + padY));
  const per = Math.max(1, maxCells > 0 ? Math.min(maxCells, Math.max(1, fit)) : fit);
  const n = items.length;
  const cols = horizontal ? Math.min(per, n) : Math.ceil(n / per);
  const rows = horizontal ? Math.ceil(n / per) : Math.min(per, n);
  const gw = cols * cellW + Math.max(0, cols - 1) * padX;
  const gh = rows * cellH + Math.max(0, rows - 1) * padY;
  const sx = align(enumName(layout.get('HorizontalAlignment')), cw, gw, 'Left', 'Right');
  const sy = align(enumName(layout.get('VerticalAlignment')), ch, gh, 'Top', 'Bottom');
  const corner = enumName(layout.get('StartCorner')) ?? 'TopLeft';
  items.forEach((it, i) => {
    let col = horizontal ? i % per : Math.floor(i / per);
    let row = horizontal ? Math.floor(i / per) : i % per;
    if (corner.endsWith('Right')) col = cols - 1 - col;
    if (corner.startsWith('Bottom')) row = rows - 1 - row;
    sizeOf(it, cw, ch, env, { w: cellW, h: cellH });
    it.box.x = ox + sx + col * (cellW + padX);
    it.box.y = oy + sy + row * (cellH + padY);
  });
  return { w: gw, h: gh };
}

/** Absolute position in viewport pixels (rotation ignored, like Roblox's AbsolutePosition). */
export function absolutePosition(inst: Inst): { x: number; y: number } {
  let x = 0, y = 0;
  for (let p: Inst | null = inst; p; p = p.parent) {
    x += p.box.x;
    y += p.box.y;
    if (p.className === 'ScreenGui') break;
    const par = p.parent;
    if (par?.className === 'ScrollingFrame') {
      const cp = par.get('CanvasPosition') as Vector2;
      x -= cp.x;
      y -= cp.y;
    }
  }
  return { x, y };
}
