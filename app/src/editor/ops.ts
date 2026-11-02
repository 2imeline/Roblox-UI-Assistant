// Document edits shared by the canvas, hierarchy, palette and inspector.
import { isGuiObject } from '../core/classes';
import type { Inst } from '../core/instance';
import { padding } from '../core/layout';
import { parseLiteral } from '../core/literal';
import { type EnumItem, type UDim2, type Vector2, udim2 } from '../core/values';
import { store } from './store';

/** Starting properties for components added from the palette (explicit, so Studio matches the builder). */
const NEW_PROPS: Record<string, Record<string, string>> = {
  Frame: { Size: 'UDim2.new(0, 200, 0, 120)', BackgroundColor3: 'Color3.fromRGB(32, 34, 40)', BorderSizePixel: '0' },
  CanvasGroup: { Size: 'UDim2.new(0, 200, 0, 120)', BackgroundColor3: 'Color3.fromRGB(32, 34, 40)', BorderSizePixel: '0' },
  ScrollingFrame: { Size: 'UDim2.new(0, 280, 0, 200)', BackgroundColor3: 'Color3.fromRGB(24, 25, 30)', BorderSizePixel: '0', CanvasSize: 'UDim2.new(0, 0, 2, 0)', ScrollBarThickness: '6' },
  TextLabel: {
    Size: 'UDim2.new(0, 200, 0, 40)', BackgroundTransparency: '1', BorderSizePixel: '0', Text: '"Label"', TextColor3: 'Color3.fromRGB(240, 240, 245)', TextSize: '20',
    FontFace: 'Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Medium, Enum.FontStyle.Normal)',
  },
  TextButton: {
    Size: 'UDim2.new(0, 180, 0, 48)', BackgroundColor3: 'Color3.fromRGB(70, 72, 84)', BorderSizePixel: '0', Text: '"Button"', TextColor3: 'Color3.fromRGB(255, 255, 255)', TextSize: '20',
    FontFace: 'Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Bold, Enum.FontStyle.Normal)',
  },
  TextBox: {
    Size: 'UDim2.new(0, 220, 0, 40)', BackgroundColor3: 'Color3.fromRGB(24, 25, 30)', BorderSizePixel: '0', Text: '""', PlaceholderText: '"Type here"', TextColor3: 'Color3.fromRGB(240, 240, 245)', TextSize: '18',
    FontFace: 'Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)',
  },
  ImageLabel: { Size: 'UDim2.new(0, 100, 0, 100)', BackgroundTransparency: '1', BorderSizePixel: '0' },
  ImageButton: { Size: 'UDim2.new(0, 100, 0, 100)', BackgroundTransparency: '1', BorderSizePixel: '0' },
  UIStroke: { Color: 'Color3.fromRGB(255, 255, 255)', Thickness: '2' },
  UIPadding: { PaddingTop: 'UDim.new(0, 8)', PaddingBottom: 'UDim.new(0, 8)', PaddingLeft: 'UDim.new(0, 8)', PaddingRight: 'UDim.new(0, 8)' },
  UIListLayout: { Padding: 'UDim.new(0, 8)', SortOrder: 'Enum.SortOrder.LayoutOrder' },
  UIGridLayout: { SortOrder: 'Enum.SortOrder.LayoutOrder' },
};

const enumName = (v: unknown) => (v as EnumItem | undefined)?.n;

/** Size of the area a child's scale components refer to. */
export function contentSize(parent: Inst): { w: number; h: number } {
  const w = parent.className === 'ScrollingFrame' ? Math.max(parent.box.w, parent.contentSize.x) : parent.box.w;
  const h = parent.className === 'ScrollingFrame' ? Math.max(parent.box.h, parent.contentSize.y) : parent.box.h;
  const p = padding(parent, w, h);
  return { w: Math.max(1, w - p.l - p.r), h: Math.max(1, h - p.t - p.b) };
}

export function layoutOf(parent: Inst | null): Inst | undefined {
  return parent?.children.find((c) => c.className === 'UIListLayout' || c.className === 'UIGridLayout');
}

export function uniqueName(parent: Inst, base: string) {
  if (!parent.findFirstChild(base)) return base;
  for (let i = 2; ; i++) if (!parent.findFirstChild(`${base}${i}`)) return `${base}${i}`;
}

/** Adds a new instance; `at` is a point in the parent's content area (px). */
export function createInstance(cls: string, parent: Inst, at?: { x: number; y: number }): Inst {
  const inst = store.world.create(cls, uniqueName(parent, cls));
  for (const [k, lit] of Object.entries(NEW_PROPS[cls] ?? {})) inst.set(k, parseLiteral(lit));
  if (at && isGuiObject(cls)) inst.set('Position', udim2(0, at.x, 0, at.y));
  inst.setParent(parent);
  return inst;
}

export function duplicate(inst: Inst, parent: Inst | null = inst.parent, at?: { x: number; y: number }): Inst | null {
  if (!parent) return null;
  const c = inst.clone();
  c.setName(uniqueName(parent, inst.name));
  if (isGuiObject(c.className)) {
    if (at) {
      const a = c.get('AnchorPoint') as Vector2;
      c.set('Position', udim2(0, at.x + a.x * inst.box.w, 0, at.y + a.y * inst.box.h));
    } else if (!layoutOf(parent)) {
      const p = c.get('Position') as UDim2;
      c.set('Position', udim2(p.xs, p.xo + 16, p.ys, p.yo + 16));
    }
  }
  c.setParent(parent, parent === inst.parent ? parent.children.indexOf(inst) + 1 : undefined);
  return c;
}

/** Applies a pixel delta to a UDim, keeping the author's choice of scale vs offset. */
function shift(scale: number, offset: number, d: number, ref: number): [number, number] {
  if (scale !== 0 && offset === 0) return [+(scale + d / ref).toFixed(4), 0];
  return [scale, Math.round(offset + d)];
}

export function movedPosition(inst: Inst, p0: UDim2, dx: number, dy: number): UDim2 {
  const ref = inst.parent ? contentSize(inst.parent) : { w: 1, h: 1 };
  const [xs, xo] = shift(p0.xs, p0.xo, dx, ref.w);
  const [ys, yo] = shift(p0.ys, p0.yo, dy, ref.h);
  return udim2(xs, xo, ys, yo);
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Resize from a handle; the opposite edge stays fixed. */
export function resized(inst: Inst, handle: Handle, s0: UDim2, p0: UDim2, w0: number, h0: number, dx: number, dy: number): { size: UDim2; pos: UDim2 } {
  const ref = inst.parent ? contentSize(inst.parent) : { w: 1, h: 1 };
  const sc = enumName(inst.get('SizeConstraint'));
  const rw = sc === 'RelativeYY' ? ref.h : ref.w, rh = sc === 'RelativeXX' ? ref.w : ref.h;
  const a = inst.get('AnchorPoint') as Vector2;
  let dw = 0, dh = 0, px = 0, py = 0;
  if (handle.includes('e')) { dw = dx; px = a.x * dx; }
  if (handle.includes('w')) { dw = -dx; px = dx * (1 - a.x); }
  if (handle.includes('s')) { dh = dy; py = a.y * dy; }
  if (handle.includes('n')) { dh = -dy; py = dy * (1 - a.y); }
  dw = Math.max(dw, -w0);
  dh = Math.max(dh, -h0);
  if (handle.includes('w') && dw === -w0) px = w0 * (1 - a.x);
  if (handle.includes('n') && dh === -h0) py = h0 * (1 - a.y);
  const [sxs, sxo] = shift(s0.xs, s0.xo, dw, rw);
  const [sys, syo] = shift(s0.ys, s0.yo, dh, rh);
  const [pxs, pxo] = shift(p0.xs, p0.xo, px, ref.w);
  const [pys, pyo] = shift(p0.ys, p0.yo, py, ref.h);
  return { size: udim2(sxs, sxo, sys, syo), pos: udim2(pxs, pxo, pys, pyo) };
}

/** Sibling GuiObjects in on-screen order for a UIListLayout/UIGridLayout parent. */
export function laidOutSiblings(parent: Inst): Inst[] {
  const layout = layoutOf(parent);
  const items = parent.children.filter((c) => isGuiObject(c.className) && c.get('Visible') !== false);
  if (!layout || enumName(layout.get('SortOrder')) === 'Name') return items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const idx = new Map(items.map((c, i) => [c, i]));
  return items.sort((a, b) => Number(a.get('LayoutOrder')) - Number(b.get('LayoutOrder')) || idx.get(a)! - idx.get(b)!);
}

/** Moves `inst` to position `index` in its layout order by renumbering LayoutOrder. Returns false when the layout sorts by Name. */
export function reorder(inst: Inst, index: number): boolean {
  const parent = inst.parent!;
  const layout = layoutOf(parent);
  if (layout && enumName(layout.get('SortOrder')) === 'Name') return false;
  const order = laidOutSiblings(parent).filter((c) => c !== inst);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, inst);
  order.forEach((c, i) => c.set('LayoutOrder', i + 1));
  return true;
}

export function removeSelected() {
  const s = store.selection;
  if (!s || s === store.root) return;
  const parent = s.parent;
  s.destroy();
  store.select(parent && parent !== store.root ? parent : null);
  store.commit();
}

export function duplicateSelected() {
  const s = store.selection;
  if (!s || s === store.root) return;
  const c = duplicate(s);
  if (c) { store.select(c); store.commit(); }
}

/** Reparents with cycle protection; index is among parent's children. */
export function reparent(inst: Inst, parent: Inst, index?: number) {
  if (inst === store.root || parent === inst || parent.isDescendantOf(inst)) return false;
  inst.setParent(parent, index);
  return true;
}
