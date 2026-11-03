// The instance tree shared by the editor, renderer and Luau runtime.
import { FONT_ENUM_FACE } from './enums';
import { defaultsOf, isA } from './classes';
import { type Font, type Value, en, equals, font } from './values';

export type WorldEvent =
  | { k: 'prop'; inst: Inst; key: string }
  | { k: 'attr'; inst: Inst; key: string }
  | { k: 'tree'; inst: Inst; oldParent: Inst | null }
  | { k: 'destroy'; inst: Inst };

export class World {
  readonly byId = new Map<number, Inst>();
  private nextId = 1;
  private listeners = new Set<(ev: WorldEvent) => void>();

  create(className: string, name = className): Inst {
    const inst = new Inst(this, this.nextId++, className, name);
    this.byId.set(inst.id, inst);
    return inst;
  }
  on(fn: (ev: WorldEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev: WorldEvent) { for (const fn of this.listeners) fn(ev); }
}

/** Layout output, written by layout.ts. Positions are relative to the parent GuiObject's top-left (or its canvas). */
export interface Box { x: number; y: number; w: number; h: number }

export class Inst {
  parent: Inst | null = null;
  children: Inst[] = [];
  readonly props = new Map<string, Value>();
  readonly attrs = new Map<string, Value>();
  destroyed = false;
  /** Script and line that created it while playing ("MainMenu:120"), for the live Explorer. */
  origin?: string;
  box: Box = { x: 0, y: 0, w: 0, h: 0 };
  /** Absolute content size for UIListLayout/UIGridLayout, canvas size for ScrollingFrame. */
  contentSize = { x: 0, y: 0 };

  constructor(readonly world: World, readonly id: number, readonly className: string, public name: string) {}

  get(key: string): Value | undefined {
    if (key === 'Name') return this.name;
    if (key === 'ClassName') return this.className;
    if (key === 'Font' && isA(this.className, 'GuiObject')) return fontEnumOf(this.get('FontFace') as Font | undefined);
    const v = this.props.get(key);
    return v !== undefined ? v : defaultsOf(this.className).get(key);
  }

  has(key: string) {
    const d = defaultsOf(this.className);
    return key === 'Name' || key === 'ClassName' || this.props.has(key) || d.has(key) || (key === 'Font' && d.has('FontFace'));
  }

  /** Sets a property; Font is stored as its FontFace equivalent, like Roblox does. */
  set(key: string, value: Value) {
    if (key === 'Name') { this.setName(String(value)); return; }
    if (key === 'Font' && value && typeof value === 'object' && value.t === 'Enum') {
      const f = FONT_ENUM_FACE[value.n];
      if (f) { this.set('FontFace', font(f[0], f[1], f[2])); return; }
    }
    if (equals(this.props.get(key), value)) return;
    this.props.set(key, value);
    this.world.emit({ k: 'prop', inst: this, key });
  }

  reset(key: string) {
    if (!this.props.delete(key)) return;
    this.world.emit({ k: 'prop', inst: this, key });
  }

  setName(name: string) {
    if (name === this.name) return;
    this.name = name;
    this.world.emit({ k: 'prop', inst: this, key: 'Name' });
  }

  setAttr(key: string, value: Value) {
    if (value === null) this.attrs.delete(key);
    else this.attrs.set(key, value);
    this.world.emit({ k: 'attr', inst: this, key });
  }

  /** Reparents; `index` inserts at a sibling position (default: last). */
  setParent(parent: Inst | null, index?: number) {
    if (this.destroyed) throw new Error(`The Parent property of ${this.name} is locked`);
    if (parent && (parent === this || parent.isDescendantOf(this))) throw new Error(`Attempt to set parent of ${this.name} to ${parent.name} would result in circular reference`);
    const old = this.parent;
    if (old) old.children.splice(old.children.indexOf(this), 1);
    this.parent = parent;
    if (parent) {
      const i = index === undefined ? parent.children.length : Math.max(0, Math.min(index, parent.children.length));
      parent.children.splice(i, 0, this);
    }
    this.world.emit({ k: 'tree', inst: this, oldParent: old });
  }

  destroy() {
    if (this.destroyed) return;
    for (const c of [...this.children]) c.destroy();
    this.world.emit({ k: 'destroy', inst: this });
    if (this.parent) this.setParent(null);
    // Stays in byId: Roblox scripts may still read properties of destroyed instances.
    this.destroyed = true;
  }

  /** Deep copy into `world` (defaults to the same world). */
  clone(world: World = this.world): Inst {
    const c = world.create(this.className, this.name);
    for (const [k, v] of this.props) c.props.set(k, v);
    for (const [k, v] of this.attrs) c.attrs.set(k, v);
    for (const ch of this.children) ch.clone(world).setParent(c);
    return c;
  }

  isA(cls: string) { return isA(this.className, cls); }
  isDescendantOf(other: Inst): boolean {
    for (let p = this.parent; p; p = p.parent) if (p === other) return true;
    return false;
  }
  findFirstChild(name: string, recursive = false): Inst | undefined {
    for (const c of this.children) if (c.name === name) return c;
    if (recursive) for (const c of this.children) { const f = c.findFirstChild(name, true); if (f) return f; }
    return undefined;
  }
  descendants(out: Inst[] = []): Inst[] {
    for (const c of this.children) { out.push(c); c.descendants(out); }
    return out;
  }
  fullName(): string {
    const parts: string[] = [];
    for (let p: Inst | null = this; p && p.className !== 'DataModel'; p = p.parent) parts.unshift(p.name);
    return parts.join('.');
  }
  /** Index path from `root` (for re-selecting after undo/redo). */
  pathFrom(root: Inst): number[] | null {
    const path: number[] = [];
    for (let p: Inst = this; p !== root; p = p.parent!) {
      if (!p.parent) return null;
      path.unshift(p.parent.children.indexOf(p));
    }
    return path;
  }
}

export function atPath(root: Inst, path: number[]): Inst | undefined {
  let cur: Inst | undefined = root;
  for (const i of path) cur = cur?.children[i];
  return cur;
}

function fontEnumOf(f: Font | undefined) {
  if (!f) return en('Font', 'Legacy');
  for (const [n, [fam, w, s]] of Object.entries(FONT_ENUM_FACE)) if (fam === f.family && w === f.weight && s === f.style) return en('Font', n);
  return en('Font', 'Unknown');
}
