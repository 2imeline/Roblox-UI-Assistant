// Editor state: the open document, selection, undo history, mode and console. Panels subscribe via useStore().
import { useSyncExternalStore } from 'react';
import { type Inst, World, atPath } from '../core/instance';
import { type Component, parseRblxui, toComponent, toRblxui } from '../core/rblxui';
import type { LogKind } from '../runtime/runtime';

export interface Device { id: string; label: string; w: number; h: number; touch: boolean; safe: { l: number; t: number; r: number; b: number } }
const S0 = { l: 0, t: 0, r: 0, b: 0 };
export const DEVICES: Device[] = [
  { id: 'desktop', label: 'Desktop · 1920×1080', w: 1920, h: 1080, touch: false, safe: S0 },
  { id: 'laptop', label: 'Laptop · 1366×768', w: 1366, h: 768, touch: false, safe: S0 },
  { id: 'tablet', label: 'Tablet · 1024×768', w: 1024, h: 768, touch: true, safe: S0 },
  { id: 'phone', label: 'Phone · 844×390', w: 844, h: 390, touch: true, safe: { l: 47, t: 0, r: 47, b: 21 } },
  { id: 'phone-portrait', label: 'Phone portrait · 390×844', w: 390, h: 844, touch: true, safe: { l: 0, t: 47, r: 0, b: 34 } },
];
export const TOPBAR = 58;

export interface LogEntry { id: number; kind: LogKind; msg: string; trace?: string; time: number }

const BLANK = { schema: 'rblxui/1.0', instructions: '', screenGui: { name: 'ScreenGui', properties: { ResetOnSpawn: 'false', ZIndexBehavior: 'Enum.ZIndexBehavior.Sibling' } } };

class Store {
  world = new World();
  root: Inst;
  extra: Record<string, unknown> = {};
  path: string | null = null;
  name = 'Untitled';
  dirty = false;
  selection: Inst | null = null;
  mode: 'edit' | 'play' = 'edit';
  device: Device = DEVICES[0];
  zoom: 'fit' | number = 'fit';
  backdrop = 'sky';
  showTopbar = true;
  logs: LogEntry[] = [];
  mcp: 'off' | 'connecting' | 'connected' = 'off';
  /** Bumped on every change; panels re-render from it. */
  version = 0;
  treeVersion = 0;

  private history: string[] = [];
  private index = -1;
  private listeners = new Set<() => void>();
  private pending = false;
  private logId = 0;
  private offWorld: () => void = () => {};

  constructor() {
    this.root = this.adopt(parseRblxui(BLANK, this.world).root);
    this.snapshot();
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };

  /** Coalesces notifications to one per frame. */
  changed(tree = false) {
    if (tree) this.treeVersion++;
    if (this.pending) return;
    this.pending = true;
    const fire = () => { this.pending = false; this.version++; for (const l of this.listeners) l(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fire);
    else queueMicrotask(fire);
  }

  private adopt(root: Inst) {
    this.offWorld();
    this.offWorld = root.world.on((ev) => this.changed(ev.k !== 'prop' || ev.key === 'Name'));
    return root;
  }

  log(kind: LogKind, msg: string, trace?: string) {
    this.logs.push({ id: ++this.logId, kind, msg, trace, time: Date.now() });
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    this.changed();
  }
  clearLogs() { this.logs = []; this.changed(); }

  /** Replaces the document. Throws RblxuiError on unreadable input. */
  load(input: string | object, path: string | null = null, name?: string) {
    const world = new World();
    const { root, warnings, extra } = parseRblxui(input, world);
    this.world = world;
    this.root = this.adopt(root);
    this.extra = extra;
    this.path = path;
    this.name = name ?? (path ? path.split(/[\\/]/).pop()!.replace(/\.rblxui$/i, '') : root.name);
    this.selection = null;
    this.history = [];
    this.index = -1;
    this.snapshot();
    this.dirty = false;
    for (const w of warnings) this.log('warn', w);
    this.changed(true);
    return warnings;
  }

  /** Replaces the document but keeps undo history, so a pushed preview can be undone. */
  replace(input: string | object) {
    const before = this.history.slice(0, this.index + 1);
    const { root, warnings, extra } = parseRblxui(input, new World());
    this.world = root.world;
    this.root = this.adopt(root);
    this.extra = extra;
    if (!this.path) this.name = root.name;
    this.selection = null;
    this.history = before;
    this.index = before.length - 1;
    this.commit();
    for (const w of warnings) this.log('warn', w);
    return warnings;
  }

  file(withLua = true) { return toRblxui(this.root, this.extra, withLua); }

  private snapshot() {
    const s = JSON.stringify(toComponent(this.root));
    if (this.history[this.index] === s) return false;
    this.history.splice(this.index + 1);
    this.history.push(s);
    if (this.history.length > 200) this.history.shift();
    this.index = this.history.length - 1;
    return true;
  }

  /** Call after a finished edit (drag end, inspector commit...). */
  commit() {
    if (this.snapshot()) { this.dirty = true; this.changed(true); }
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.history.length - 1; }
  undo() { if (this.canUndo) this.restore(--this.index); }
  redo() { if (this.canRedo) this.restore(++this.index); }

  private restore(i: number) {
    const path = this.selection?.pathFrom(this.root) ?? null;
    const world = new World();
    const { root } = parseRblxui({ schema: 'rblxui/1.0', screenGui: JSON.parse(this.history[i]) as Component }, world);
    this.world = world;
    this.root = this.adopt(root);
    this.selection = path ? atPath(this.root, path) ?? null : null;
    this.dirty = true;
    this.changed(true);
  }

  select(inst: Inst | null) {
    if (this.selection === inst) return;
    this.selection = inst;
    this.changed();
  }

  set<K extends 'mode' | 'device' | 'zoom' | 'backdrop' | 'showTopbar' | 'mcp' | 'path' | 'name' | 'dirty'>(k: K, v: Store[K]) {
    if ((this as Store)[k] === v) return;
    (this as Store)[k] = v;
    this.changed();
  }
}

export const store = new Store();
if (typeof window !== 'undefined') (window as unknown as { __rbxStore: Store }).__rbxStore = store;

export function useStore() {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store;
}
