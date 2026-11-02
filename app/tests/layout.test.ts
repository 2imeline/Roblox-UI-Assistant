import { describe, expect, it } from 'vitest';
import { parseRblxui } from '../src/core/rblxui';
import { layoutScreenGui, absolutePosition, type LayoutEnv } from '../src/core/layout';
import type { Inst } from '../src/core/instance';

const env: LayoutEnv = {
  viewport: { w: 1000, h: 600 }, topInset: 58, safe: { l: 0, t: 0, r: 0, b: 0 },
  measureText: (inst) => ({ w: String(inst.get('Text')).length * 10, h: Number(inst.get('TextSize')) }),
};
const tree = (children: object[], props: object = { IgnoreGuiInset: 'true' }) => parseRblxui({ schema: 'rblxui/1.0', screenGui: { name: 'G', properties: props, children } }).root;
const find = (root: Inst, name: string) => root.findFirstChild(name, true)!;

describe('layout', () => {
  it('scale, offset and anchor point', () => {
    const root = tree([{ class: 'Frame', name: 'A', properties: { Size: 'UDim2.new(0, 200, 0, 50)', Position: 'UDim2.new(0.5, 0, 1, -20)', AnchorPoint: 'Vector2.new(0.5, 1)' } }]);
    layoutScreenGui(root, env);
    expect(find(root, 'A').box).toEqual({ x: 400, y: 530, w: 200, h: 50 });
  });

  it('respects the topbar inset unless IgnoreGuiInset', () => {
    const root = tree([{ class: 'Frame', name: 'A', properties: { Size: 'UDim2.new(1, 0, 1, 0)' } }], {});
    layoutScreenGui(root, env);
    expect(root.box.y).toBe(58);
    expect(find(root, 'A').box.h).toBe(542);
  });

  it('UIListLayout with padding, alignment and LayoutOrder', () => {
    const root = tree([{
      class: 'Frame', name: 'List', properties: { Size: 'UDim2.new(0, 300, 0, 400)' },
      children: [
        { class: 'UIListLayout', name: 'L', properties: { Padding: 'UDim.new(0, 10)', HorizontalAlignment: 'Enum.HorizontalAlignment.Center', SortOrder: 'Enum.SortOrder.LayoutOrder' } },
        { class: 'UIPadding', name: 'P', properties: { PaddingTop: 'UDim.new(0, 5)' } },
        { class: 'Frame', name: 'B', properties: { Size: 'UDim2.new(1, 0, 0, 40)', LayoutOrder: '2' } },
        { class: 'Frame', name: 'A', properties: { Size: 'UDim2.new(0, 100, 0, 30)', LayoutOrder: '1' } },
        { class: 'Frame', name: 'Hidden', properties: { Size: 'UDim2.new(0, 100, 0, 30)', Visible: 'false' } },
      ],
    }]);
    layoutScreenGui(root, env);
    expect(find(root, 'A').box).toEqual({ x: 100, y: 5, w: 100, h: 30 });
    expect(find(root, 'B').box).toEqual({ x: 0, y: 45, w: 300, h: 40 });
    expect(find(root, 'L').contentSize).toEqual({ x: 300, y: 80 });
  });

  it('UIGridLayout wraps cells', () => {
    const root = tree([{
      class: 'Frame', name: 'Grid', properties: { Size: 'UDim2.new(0, 230, 0, 400)' },
      children: [
        { class: 'UIGridLayout', name: 'G', properties: { CellSize: 'UDim2.new(0, 100, 0, 50)', CellPadding: 'UDim2.new(0, 10, 0, 10)' } },
        ...[1, 2, 3].map((i) => ({ class: 'Frame', name: `C${i}`, properties: { LayoutOrder: String(i) } })),
      ],
    }]);
    layoutScreenGui(root, env);
    expect(find(root, 'C2').box).toEqual({ x: 110, y: 0, w: 100, h: 50 });
    expect(find(root, 'C3').box).toEqual({ x: 0, y: 60, w: 100, h: 50 });
  });

  it('aspect ratio, size constraint and AutomaticSize', () => {
    const root = tree([
      { class: 'Frame', name: 'Sq', properties: { Size: 'UDim2.new(0.5, 0, 0.5, 0)' }, children: [{ class: 'UIAspectRatioConstraint', name: 'R' }] },
      { class: 'Frame', name: 'Max', properties: { Size: 'UDim2.new(1, 0, 0, 10)' }, children: [{ class: 'UISizeConstraint', name: 'C', properties: { MaxSize: 'Vector2.new(400, math.huge)' } }] },
      { class: 'TextLabel', name: 'Auto', properties: { Text: '"hello"', TextSize: '20', AutomaticSize: 'Enum.AutomaticSize.XY' }, children: [{ class: 'UIPadding', name: 'P', properties: { PaddingLeft: 'UDim.new(0, 4)', PaddingRight: 'UDim.new(0, 4)' } }] },
    ]);
    layoutScreenGui(root, env);
    expect(find(root, 'Sq').box).toMatchObject({ w: 300, h: 300 });
    expect(find(root, 'Max').box).toMatchObject({ w: 400, h: 10 });
    expect(find(root, 'Auto').box).toMatchObject({ w: 58, h: 20 });
  });

  it('ScrollingFrame canvas, automatic canvas size and AbsolutePosition', () => {
    const root = tree([{
      class: 'ScrollingFrame', name: 'S', properties: { Size: 'UDim2.new(0, 200, 0, 100)', Position: 'UDim2.new(0, 10, 0, 10)', CanvasSize: 'UDim2.new(0, 0, 0, 0)', AutomaticCanvasSize: 'Enum.AutomaticSize.Y', CanvasPosition: 'Vector2.new(0, 30)' },
      children: [
        { class: 'UIListLayout', name: 'L' },
        ...[1, 2, 3, 4].map((i) => ({ class: 'Frame', name: `R${i}`, properties: { Size: 'UDim2.new(1, 0, 0, 50)', LayoutOrder: String(i) } })),
      ],
    }]);
    layoutScreenGui(root, env);
    expect(find(root, 'S').contentSize).toEqual({ x: 200, y: 200 });
    expect(absolutePosition(find(root, 'R2'))).toEqual({ x: 10, y: 30 });
  });
});
