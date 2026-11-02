// Runs a UI's LocalScripts against a mock Roblox client. The instance tree stays in JS (World);
// prelude.luau provides the Luau-side API. See codec.ts for the value wire format.
import { Lua, type LuaFunction, type LuaTable } from '@luau-rs/luau';
import { defaultsOf, eventsOf, isA, isButton, isGuiObject, isTextObject, CLASSES } from '../core/classes';
import { ENUMS, FONT_ENUM_FACE, enumNameOf } from '../core/enums';
import { type Inst, World, type WorldEvent } from '../core/instance';
import { absolutePosition } from '../core/layout';
import { type EnumItem, type Font, type Value, type Vector2, en, equals, font, typeOf, v2 } from '../core/values';
import { DecodeError, NOOP, type Wire, dec, enc, encAnything, encError, encInput, encInst, encList, wireTypeName } from './codec';
import { instrument } from './instrument';
import preludeSrc from './prelude.luau?raw';
import { TweenEngine, ease } from './tween';

export type LogKind = 'out' | 'warn' | 'error' | 'info';

export interface RuntimeHost {
  log(kind: LogKind, msg: string, trace?: string): void;
  /** Brings Inst.box up to date (synchronous layout). */
  ensureLayout(): void;
  measureText(text: string, size: number, face: Font, wrapWidth: number | null): { w: number; h: number };
  /** Ask for step() to be called again after `ms` (0 = next animation frame). */
  requestStep(ms: number): void;
  focusTextBox(inst: Inst, focus: boolean): void;
  visualChanged(inst: Inst): void;
  viewport(): { w: number; h: number };
  topInset: number;
  touch: boolean;
  /** Per-entry script time budget (default 5000 ms). */
  timeoutMs?: number;
}

const BEHAVIOR_SERVICES = new Set(['TweenService', 'UserInputService', 'RunService', 'GuiService', 'ContextActionService', 'HttpService',
  'TextService', 'MarketplaceService', 'TeleportService', 'Debris', 'CollectionService', 'SocialService', 'BadgeService', 'PolicyService',
  'LocalizationService', 'ContentProvider', 'VRService', 'HapticService', 'GroupService', 'AnalyticsService', 'AvatarEditorService',
  'ProximityPromptService', 'TextChatService', 'VoiceChatService', 'StarterGui', 'SoundService', 'Players', 'DataModel', 'Chat',
  'GamePassService', 'AssetService', 'ExperienceNotificationService', 'PathfindingService', 'PhysicsService', 'ContextActionService',
  'KeyframeSequenceProvider', 'InsertService', 'LogService', 'Stats', 'NotificationService', 'GamepadService', 'MemoryStoreService', 'DataStoreService']);
const CONTAINER_SERVICES = ['Workspace', 'ReplicatedStorage', 'ReplicatedFirst', 'Lighting', 'StarterPlayer', 'StarterPack', 'ServerStorage',
  'ServerScriptService', 'Teams', 'CoreGui'];
const READ_ONLY = new Set(['ClassName', 'AbsolutePosition', 'AbsoluteSize', 'AbsoluteRotation', 'AbsoluteCanvasSize', 'AbsoluteWindowSize',
  'AbsoluteContentSize', 'TextBounds', 'TextFits', 'LocalPlayer', 'PlaybackState', 'IsPlaying', 'IsLoaded', 'GuiState']);
const STRICT_BASES = ['GuiBase2d', 'UIBase', 'LuaSourceContainer', 'ValueBase'];
/** Properties the layout pass computes, with the base class they exist on; afterLayout fires their change events. */
const LAYOUT_PROPS: [string, string][] = [
  ['AbsoluteSize', 'GuiBase2d'], ['AbsolutePosition', 'GuiBase2d'], ['AbsoluteWindowSize', 'ScrollingFrame'],
  ['AbsoluteCanvasSize', 'ScrollingFrame'], ['AbsoluteContentSize', 'UIGridStyleLayout'], ['TextBounds', 'GuiObject'],
];
const STRICT_CLASSES = new Set(['Folder', 'Configuration', 'BindableEvent', 'BindableFunction', 'RemoteEvent', 'RemoteFunction', 'UnreliableRemoteEvent']);
const ATTR_TYPES = new Set(['nil', 'boolean', 'number', 'string', 'UDim', 'UDim2', 'Color3', 'Vector2', 'Vector3', 'NumberRange', 'Rect', 'ColorSequence', 'NumberSequence', 'Font', 'Enum']);

const CODE_MAP: Record<string, string> = {
  Space: 'Space', Enter: 'Return', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', ShiftLeft: 'LeftShift', ShiftRight: 'RightShift',
  ControlLeft: 'LeftControl', ControlRight: 'RightControl', AltLeft: 'LeftAlt', AltRight: 'RightAlt', MetaLeft: 'LeftSuper', MetaRight: 'RightSuper',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Minus: 'Minus', Equal: 'Equals', BracketLeft: 'LeftBracket',
  BracketRight: 'RightBracket', Backslash: 'BackSlash', Semicolon: 'Semicolon', Quote: 'Quote', Backquote: 'Backquote', Comma: 'Comma',
  Period: 'Period', Slash: 'Slash', CapsLock: 'CapsLock', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp',
  PageDown: 'PageDown', NumpadEnter: 'KeypadEnter', NumpadAdd: 'KeypadPlus', NumpadSubtract: 'KeypadMinus', NumpadMultiply: 'KeypadMultiply',
  NumpadDivide: 'KeypadDivide', NumpadDecimal: 'KeypadPeriod',
};
const DIGITS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
export function keyCodeOf(code: string): string {
  if (CODE_MAP[code]) return CODE_MAP[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return DIGITS[+m[1]];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'Keypad' + DIGITS[+m[1]];
  if (/^F\d{1,2}$/.test(code)) return code;
  return 'Unknown';
}

const now = () => performance.now() / 1000;

export class Runtime {
  readonly game: Inst;
  readonly playerGui: Inst;
  private lua!: Lua;
  private api!: { env: LuaFunction; run: LuaFunction; fire: LuaFunction; step: LuaFunction; dropped: LuaFunction };
  private services = new Map<string, Inst>();
  private player!: Inst;
  private mouse!: Inst;
  private camera!: Inst;
  private uis!: Inst;
  private listened = new Map<number, Set<string>>();
  private queue: { id: number; key: string; args: Wire[] }[] = [];
  private dropped: number[] = [];
  private pendingScripts: Inst[] = [];
  private ran = new WeakSet<Inst>();
  private tweens: TweenEngine;
  private deadline = Infinity;
  private depth = 0;
  private lastStep = now();
  private nextWake = -1;
  private frameSignals = false;
  private keysDown = new Set<string>();
  private buttonsDown = new Set<number>();
  private hovered: Inst[] = [];
  private pressed: Inst | null = null;
  private focused: Inst | null = null;
  private lastInputType = 'MouseMovement';
  private mousePos = { x: 0, y: 0 };
  private absCache = new Map<string, Value>();
  private warned = new Set<string>();
  private off: () => void;
  alive = true;

  private constructor(readonly world: World, private host: RuntimeHost) {
    this.tweens = new TweenEngine((tw, state) => this.enqueue(tw, 'Completed', [enc(en('PlaybackState', state))]));
    const w = world;
    this.game = w.create('DataModel', 'Game');
    for (const [k, v] of Object.entries({ PlaceId: 0, GameId: 0, JobId: '', CreatorId: 0, PlaceVersion: 0, PrivateServerId: '', PrivateServerOwnerId: 0 })) this.game.set(k, v);
    for (const name of ['Workspace', 'Players', 'ReplicatedStorage', 'ReplicatedFirst', 'StarterGui', 'StarterPlayer', 'Lighting', 'SoundService',
      'TweenService', 'UserInputService', 'RunService', 'GuiService', 'ContextActionService']) this.service(name);
    this.camera = w.create('Camera', 'Camera');
    this.camera.setParent(this.service('Workspace'));
    this.service('Workspace').set('CurrentCamera', { t: 'Ref', inst: this.camera });
    this.player = w.create('Player', 'Player');
    this.player.set('DisplayName', 'Player');
    this.player.setParent(this.service('Players'));
    this.service('Players').set('LocalPlayer', { t: 'Ref', inst: this.player });
    this.playerGui = w.create('PlayerGui', 'PlayerGui');
    this.playerGui.setParent(this.player);
    for (const n of ['Backpack', 'PlayerScripts', 'StarterGear']) w.create(n, n).setParent(this.player);
    const character = w.create('Model', 'Player');
    w.create('Humanoid', 'Humanoid').setParent(character);
    w.create('Part', 'HumanoidRootPart').setParent(character);
    w.create('Part', 'Head').setParent(character);
    character.setParent(this.service('Workspace'));
    this.player.set('Character', { t: 'Ref', inst: character });
    this.mouse = w.create('PlayerMouse', 'Mouse');
    this.uis = this.service('UserInputService');
    this.uis.set('TouchEnabled', host.touch);
    this.uis.set('MouseEnabled', !host.touch);
    this.uis.set('KeyboardEnabled', !host.touch);
    this.setViewport();
    this.off = w.on((ev) => this.onWorld(ev));
  }

  /** Creates a session and clones `screenGuis` into PlayerGui. Scripts start with start(). */
  static async create(screenGuis: Inst[], host: RuntimeHost): Promise<Runtime> {
    const rt = new Runtime(new World(), host);
    for (const sg of screenGuis) sg.clone(rt.world).setParent(rt.playerGui);
    await rt.boot();
    return rt;
  }

  private async boot() {
    this.lua = await Lua.create({ sandbox: false });
    this.lua.setMemoryLimit(512 * 1024 * 1024);
    const H = this.lua.createTable();
    const fn = (name: string, f: (...a: never[]) => unknown) =>
      H.set(name, this.lua.createFunction((...a: unknown[]) => {
        try { return (f as (...x: unknown[]) => unknown)(...a) as never; } catch (e) { return encError(e instanceof Error ? e.message : String(e)) as never; }
      }));
    fn('log', (kind: LogKind, msg: string, trace?: string) => this.host.log(kind, String(msg), trace ? String(trace) : undefined));
    fn('get', (id: number, key: string) => this.get(id, key));
    fn('set', (id: number, key: string, v: Wire) => this.set(id, key, v));
    fn('call', (id: number, method: string, ...args: Wire[]) => this.call(id, method, args));
    fn('listen', (id: number, key: string) => { this.listen(id, key); });
    fn('wake', (t: number) => {
      const at = now() + t;
      if (this.nextWake < 0 || at < this.nextWake) this.nextWake = at;
      this.host.requestStep(Math.max(0, t * 1000));
    });
    fn('now', () => now());
    fn('chk', () => performance.now() > this.deadline);

    const classes: Record<string, { base?: string; events: string[] }> = {};
    for (const [name, c] of CLASSES) classes[name] = { base: c.base, events: c.events };
    const init = {
      now: now(), epochOffset: Date.now() / 1000 - now(),
      game: this.game.id, player: this.player.id, uis: this.uis.id,
      runService: this.service('RunService').id, tweenService: this.service('TweenService').id,
      fontFaces: FONT_ENUM_FACE,
    };
    const [api] = this.lua.load(preludeSrc, { name: '=RobloxMock' }).call(H, classes, ENUMS, init) as [LuaTable];
    this.api = {
      env: api.get('env') as LuaFunction, run: api.get('run') as LuaFunction, fire: api.get('fire') as LuaFunction,
      step: api.get('step') as LuaFunction, dropped: api.get('dropped') as LuaFunction,
    };
  }

  /** Runs every enabled LocalScript under PlayerGui, in tree order. */
  start() {
    for (const inst of this.playerGui.descendants()) if (this.runnable(inst)) this.runScript(inst);
    this.flush();
  }

  stop() {
    this.alive = false;
    this.off();
    this.queue = [];
  }

  private runnable(inst: Inst) {
    return inst.className === 'LocalScript' && inst.get('Enabled') !== false && !this.ran.has(inst) && inst.isDescendantOf(this.playerGui);
  }

  private runScript(inst: Inst) {
    this.ran.add(inst);
    const [env] = this.api.env.call(inst.id, inst.className) as [LuaTable];
    let chunk: LuaFunction;
    try {
      chunk = this.lua.load(instrument(String(inst.get('Source') ?? '')), { name: '=' + inst.fullName(), environment: env });
    } catch (e) {
      this.host.log('error', cleanError((e as Error).message));
      return;
    }
    this.enter(() => this.api.run.call(chunk));
  }

  private loadModule(inst: Inst): LuaFunction {
    const [env] = this.api.env.call(inst.id, inst.className) as [LuaTable];
    try {
      return this.lua.load(instrument(String(inst.get('Source') ?? '')), { name: '=' + inst.fullName(), environment: env });
    } catch (e) {
      throw new Error(cleanError((e as Error).message));
    }
  }

  /** Every call into Luau goes through here: one time budget per outermost entry. */
  private enter(f: () => unknown) {
    if (!this.alive) return;
    const outer = this.depth === 0;
    if (outer) this.deadline = performance.now() + (this.host.timeoutMs ?? 5000);
    this.depth++;
    try { f(); } catch (e) { this.host.log('error', cleanError((e as Error).message)); }
    finally { this.depth--; }
  }

  // ---------- frame loop ----------

  /** Advances tweens and the Luau scheduler. Returns ms until the next needed step (-1 = idle). */
  step(nowMs = performance.now()): number {
    if (!this.alive) return -1;
    const t = nowMs / 1000;
    const dt = Math.min(Math.max(t - this.lastStep, 0), 0.25);
    this.lastStep = t;
    this.tweens.step(dt);
    if (this.frameSignals || (this.nextWake >= 0 && this.nextWake <= t + 0.004)) {
      this.nextWake = -1;
      this.enter(() => {
        const [wake, frames] = this.api.step.call(t, dt) as [number, boolean];
        if (wake >= 0 && (this.nextWake < 0 || t + wake < this.nextWake)) this.nextWake = t + wake;
        this.frameSignals = frames;
      });
    }
    this.flush();
    if (this.tweens.busy || this.frameSignals || this.queue.length) return 0;
    if (this.nextWake >= 0) return Math.max(0, (this.nextWake - now()) * 1000);
    return -1;
  }

  // ---------- events ----------

  private listen(id: number, key: string) {
    let s = this.listened.get(id);
    if (!s) this.listened.set(id, (s = new Set()));
    s.add(key);
    // Record the current value so the next layout pass can tell whether it changed.
    const p = LAYOUT_PROPS.find(([k]) => key === 'prop:' + k);
    const inst = p && this.world.byId.get(id);
    if (p && inst && isA(inst.className, p[1])) { const v = this.computed(inst, p[0]); if (v !== undefined) this.absCache.set(id + p[0], v); }
  }
  private has(inst: Inst, key: string) { return this.listened.get(inst.id)?.has(key) === true; }

  private enqueue(inst: Inst, key: string, args: Wire[] = []) {
    if (!this.has(inst, key)) return;
    this.queue.push({ id: inst.id, key, args });
    if (this.depth === 0) this.host.requestStep(0);
  }

  /** Deferred event delivery, like Roblox's SignalBehavior.Deferred. */
  flush() {
    // Re-entered from inside Luau (a property read that ran layout, a focus change): the outer flush delivers.
    if (this.depth > 0) return;
    for (let round = 0; round < 50 && (this.queue.length || this.pendingScripts.length || this.dropped.length); round++) {
      const scripts = this.pendingScripts.splice(0);
      for (const s of scripts) if (this.runnable(s)) this.runScript(s);
      const batch = this.queue.splice(0);
      for (const e of batch) this.enter(() => this.api.fire.call(e.id, e.key, ...e.args.map((a) => a ?? null)));
      // Drop signals only once queued events (such as Destroying) have been delivered.
      if (!this.queue.length) for (const id of this.dropped.splice(0)) this.enter(() => this.api.dropped.call(id));
    }
    if (this.queue.length) { this.host.log('warn', 'Event re-entrancy depth exceeded; some events were dropped'); this.queue = []; }
  }

  private onWorld(ev: WorldEvent) {
    const inst = ev.inst;
    if (ev.k === 'prop') {
      if (ev.key === 'Enabled' && this.runnable(inst)) { this.pendingScripts.push(inst); if (this.depth === 0) this.host.requestStep(0); }
      if (!this.listened.has(inst.id)) return;
      this.enqueue(inst, 'prop:' + ev.key);
      if (isA(inst.className, 'ValueBase')) { if (ev.key === 'Value') this.enqueue(inst, 'Changed', [enc(inst.get('Value'))]); }
      else this.enqueue(inst, 'Changed', [ev.key]);
    } else if (ev.k === 'attr') {
      this.enqueue(inst, 'attr:' + ev.key);
      this.enqueue(inst, 'AttributeChanged', [ev.key]);
    } else if (ev.k === 'tree') {
      const ref = encInst(inst);
      if (ev.oldParent) {
        this.enqueue(ev.oldParent, 'ChildRemoved', [ref]);
        for (let p: Inst | null = ev.oldParent; p; p = p.parent) this.enqueue(p, 'DescendantRemoving', [ref]);
      }
      if (inst.parent) {
        this.enqueue(inst.parent, 'ChildAdded', [ref]);
        for (let p: Inst | null = inst.parent; p; p = p.parent) this.enqueue(p, 'DescendantAdded', [ref]);
      }
      this.enqueue(inst, 'AncestryChanged', [ref, encInst(inst.parent)]);
      this.enqueue(inst, 'prop:Parent');
      this.enqueue(inst, 'Changed', ['Parent']);
      if (inst.parent && (inst.parent === this.playerGui || inst.isDescendantOf(this.playerGui))) {
        for (const d of [inst, ...inst.descendants()]) if (this.runnable(d)) this.pendingScripts.push(d);
        if (this.pendingScripts.length && this.depth === 0) this.host.requestStep(0);
      }
    } else if (ev.k === 'destroy') {
      this.enqueue(inst, 'Destroying');
      if (this.listened.delete(inst.id)) this.dropped.push(inst.id);
    }
  }

  /** Fires Absolute* change events; call after each layout pass. */
  afterLayout() {
    for (const [id, keys] of this.listened) {
      const all = keys.has('Changed');
      let inst: Inst | undefined;
      for (const [key, base] of LAYOUT_PROPS) {
        if (!all && !keys.has('prop:' + key)) continue;
        inst ??= this.world.byId.get(id);
        if (!inst || inst.destroyed) break;
        if (!isA(inst.className, base)) continue;
        const v = this.computed(inst, key);
        if (v === undefined) continue;
        const ck = id + key;
        const old = this.absCache.get(ck);
        if (old !== undefined && !equals(old, v)) {
          this.enqueue(inst, 'prop:' + key);
          this.enqueue(inst, 'Changed', [key]);
        }
        this.absCache.set(ck, v);
      }
    }
    this.flush();
  }

  setViewport() {
    const vp = this.host.viewport();
    this.camera.set('ViewportSize', v2(vp.w, vp.h));
  }

  // ---------- property access ----------

  private inst(id: number): Inst {
    const i = this.world.byId.get(id);
    if (!i) throw new Error('Instance no longer exists');
    return i;
  }

  private outsideUI(inst: Inst) { return inst !== this.playerGui && !inst.isDescendantOf(this.playerGui); }

  private computed(inst: Inst, key: string): Value | undefined {
    switch (key) {
      case 'AbsolutePosition': { this.host.ensureLayout(); const p = absolutePosition(inst); return v2(p.x, p.y - this.host.topInset); }
      case 'AbsoluteSize': this.host.ensureLayout(); return v2(inst.box.w, inst.box.h);
      case 'AbsoluteRotation': { let r = 0; for (let p: Inst | null = inst; p && isGuiObject(p.className); p = p.parent) r += Number(p.get('Rotation')) || 0; return r; }
      case 'AbsoluteWindowSize': this.host.ensureLayout(); return v2(inst.box.w, inst.box.h);
      case 'AbsoluteCanvasSize':
      case 'AbsoluteContentSize': this.host.ensureLayout(); return v2(inst.contentSize.x, inst.contentSize.y);
      case 'TextBounds': case 'TextFits': {
        if (!isTextObject(inst.className)) return undefined;
        this.host.ensureLayout();
        const m = this.host.measureText(String(inst.get('Text')), Number(inst.get('TextSize')), inst.get('FontFace') as Font, inst.get('TextWrapped') ? inst.box.w : null);
        return key === 'TextBounds' ? v2(m.w, m.h) : m.w <= inst.box.w + 0.5 && m.h <= inst.box.h + 0.5;
      }
      case 'IsPlaying': return inst.className === 'Sound' ? inst.get('Playing') === true : undefined;
      case 'IsLoaded': return inst.className === 'Sound' ? true : undefined;
    }
    return undefined;
  }

  private get(id: number, key: string): Wire {
    const inst = this.inst(id);
    if (key === 'Parent') return encInst(inst.parent);
    const c = this.computed(inst, key);
    if (c !== undefined) return enc(c);
    if (inst.has(key)) return enc(inst.get(key));
    const child = inst.findFirstChild(key);
    if (child) return encInst(child);
    if (BEHAVIOR_SERVICES.has(inst.className)) return NOOP;
    if (this.outsideUI(inst)) return encAnything(`${inst.fullName()}.${key}`);
    if (STRICT_CLASSES.has(inst.className) || STRICT_BASES.some((b) => isA(inst.className, b))) {
      return encError(`${key} is not a valid member of ${inst.className} "${inst.fullName()}"`);
    }
    return null;
  }

  private set(id: number, key: string, wire: Wire): string | null {
    const inst = this.inst(id);
    let v: Value;
    try { v = dec(wire, this.world); } catch (e) {
      if (e instanceof DecodeError) return `Unable to assign property ${key}. Got unsupported type ${e.message}`;
      throw e;
    }
    if (key === 'Parent') {
      if (inst === this.game || this.services.get(inst.className) === inst || inst === this.player || inst === this.playerGui) return `The Parent property of ${inst.name} is locked`;
      if (v !== null && (typeof v !== 'object' || v.t !== 'Ref')) return `Unable to assign property Parent. Instance expected, got ${wireTypeName(v)}`;
      const target = v === null ? null : v.inst;
      if (target?.destroyed) return `The Parent property of ${inst.name} is locked, current parent: NULL, new parent ${target.name}`;
      inst.setParent(target);
      return null;
    }
    if (key === 'Name') { inst.setName(typeof v === 'string' || typeof v === 'number' ? String(v) : ''); return null; }
    if (READ_ONLY.has(key)) return `Unable to assign property ${key}. Property is read only`;
    if (key === 'Font' && isTextObject(inst.className)) {
      const e = this.coerceEnum(v, 'Font');
      if (!e) return `Unable to assign property Font. EnumItem expected, got ${wireTypeName(v)}`;
      inst.set('Font', e);
      return null;
    }
    const def = defaultsOf(inst.className).get(key);
    if (def === undefined && !inst.props.has(key)) {
      if (STRICT_CLASSES.has(inst.className) || STRICT_BASES.some((b) => isA(inst.className, b))) {
        const w = `${inst.className}.${key}`;
        if (!this.warned.has(w)) { this.warned.add(w); this.host.log('warn', `${key} is not a property the builder knows on ${inst.className}; it is stored but has no visual effect`); }
      }
      inst.set(key, v);
      return null;
    }
    const coerced = this.coerce(key, def ?? inst.props.get(key) ?? null, v);
    if (typeof coerced === 'string' && coerced.startsWith('Unable')) return coerced;
    inst.set(key, coerced as Value);
    return null;
  }

  private coerceEnum(v: Value, enumName: string): EnumItem | null {
    if (v && typeof v === 'object' && v.t === 'Enum') return v.e === enumName ? v : null;
    if (typeof v === 'string' && ENUMS[enumName]?.[v] !== undefined) return en(enumName, v);
    if (typeof v === 'number') { const n = enumNameOf(enumName, v); return n ? en(enumName, n) : null; }
    return null;
  }

  /** Mirrors Roblox's assignment rules; returns the stored value or an "Unable to assign..." message. */
  private coerce(key: string, def: Value, v: Value): Value | string {
    const bad = (want: string) => `Unable to assign property ${key}. ${want} expected, got ${wireTypeName(v)}`;
    if (def === null) return v === null || (typeof v === 'object' && v.t === 'Ref') ? v : bad('Instance');
    if (typeof def === 'number') {
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
      return bad('number');
    }
    if (typeof def === 'string') return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : bad('string');
    if (typeof def === 'boolean') return typeof v === 'boolean' ? v : bad('bool');
    if (def.t === 'Enum') return this.coerceEnum(v, def.e) ?? (v && typeof v === 'object' && v.t === 'Enum' ? `Unable to assign property ${key}. Invalid value for enum ${def.e}` : bad('EnumItem'));
    if (typeOf(v) !== def.t) return bad(def.t);
    return v;
  }

  // ---------- methods ----------

  private service(name: string, create = true): Inst {
    let s = this.services.get(name);
    if (!s && create) {
      s = this.world.create(name, name);
      s.setParent(this.game);
      this.services.set(name, s);
    }
    return s!;
  }

  private ref(w: Wire): Inst | null {
    const v = dec(w, this.world);
    return v && typeof v === 'object' && v.t === 'Ref' ? v.inst : null;
  }

  private call(id: number, method: string, a: Wire[]): unknown {
    const inst = this.inst(id);
    const str = (i: number) => String(a[i] ?? '');
    switch (method) {
      case 'FindFirstChild': return encInst(inst.findFirstChild(str(0), a[1] === true));
      case 'FindFirstChildOfClass': return encInst(inst.children.find((c) => c.className === str(0)));
      case 'FindFirstChildWhichIsA': {
        const find = (p: Inst): Inst | undefined => {
          for (const c of p.children) if (c.isA(str(0))) return c;
          if (a[1] === true) for (const c of p.children) { const f = find(c); if (f) return f; }
          return undefined;
        };
        return encInst(find(inst));
      }
      case 'FindFirstAncestor': { let p = inst.parent; while (p && p.name !== str(0)) p = p.parent; return encInst(p); }
      case 'FindFirstAncestorOfClass': { let p = inst.parent; while (p && p.className !== str(0)) p = p.parent; return encInst(p); }
      case 'FindFirstAncestorWhichIsA': { let p = inst.parent; while (p && !p.isA(str(0))) p = p.parent; return encInst(p); }
      case 'FindFirstDescendant': return encInst(inst.descendants().find((d) => d.name === str(0)));
      case 'GetChildren': return encList(inst.children);
      case 'GetDescendants': return encList(inst.descendants());
      case 'IsA': return inst.isA(str(0));
      case 'IsDescendantOf': { const o = this.ref(a[0]); return !!o && inst.isDescendantOf(o); }
      case 'IsAncestorOf': { const o = this.ref(a[0]); return !!o && o.isDescendantOf(inst); }
      case 'Clone': return inst.get('Archivable') === false ? null : encInst(inst.clone());
      case 'Destroy':
        if (inst === this.game || this.services.get(inst.className) === inst || inst === this.player || inst === this.playerGui) throw new Error(`Cannot destroy ${inst.name}`);
        inst.destroy();
        return null;
      case 'ClearAllChildren': for (const c of [...inst.children]) c.destroy(); return null;
      case 'GetFullName': return inst.fullName();
      case 'GetDebugId': return String(inst.id);
      case 'GetAttribute': return enc(inst.attrs.get(str(0)) ?? null);
      case 'GetAttributeNames': return [...inst.attrs.keys()].join('\0');
      case 'SetAttribute': {
        const name = str(0);
        if (!/^[A-Za-z0-9_]{1,100}$/.test(name) || name.startsWith('RBX')) throw new Error(`Attribute name '${name}' is not valid`);
        const v = dec(a[1], this.world);
        if (!ATTR_TYPES.has(typeOf(v))) throw new Error(`${typeOf(v)} is not a supported attribute type`);
        inst.setAttr(name, v);
        return null;
      }
      case 'IsOutsideUI': return this.outsideUI(inst);
      case 'CaptureFocus': this.host.focusTextBox(inst, true); return null;
      case 'ReleaseFocus': this.host.focusTextBox(inst, false); return null;
      case 'IsFocused': return this.focused === inst;
      case 'Play': this.tweens.play(inst); this.host.requestStep(0); return null;
      case 'Pause': this.tweens.pause(inst); return null;
      case 'Cancel': this.tweens.cancel(inst); return null;
      case 'GetService': case 'FindService': {
        const name = str(0);
        const known = this.services.get(name) || BEHAVIOR_SERVICES.has(name) || CONTAINER_SERVICES.includes(name) || name.endsWith('Service');
        if (!known) { if (method === 'FindService') return null; throw new Error(`'${name}' is not a valid Service name`); }
        return encInst(this.service(name));
      }
      case 'CreateInstance': {
        const cls = str(0);
        const info = CLASSES.get(cls);
        if ((info && !info.creatable) || !/^[A-Z][A-Za-z0-9]*$/.test(cls) || BEHAVIOR_SERVICES.has(cls)) throw new Error(`Unable to create an Instance of type "${cls}"`);
        return encInst(this.world.create(cls, cls));
      }
      case 'GetMouse': return encInst(this.mouse);
      case 'GetMouseLocation': return enc(v2(this.mousePos.x, this.mousePos.y));
      case 'IsKeyDown': { const v = dec(a[0], this.world) as EnumItem; return !!v && this.keysDown.has(v.n); }
      case 'IsMouseButtonPressed': { const v = dec(a[0], this.world) as EnumItem; return !!v && this.buttonsDown.has(v.n === 'MouseButton2' ? 2 : v.n === 'MouseButton3' ? 1 : 0); }
      case 'GetFocusedTextBox': return encInst(this.focused);
      case 'GetLastInputType': return enc(en('UserInputType', this.lastInputType));
      case 'GetGuiInset': return enc(v2(0, this.host.topInset));
      case 'GetTextSize': {
        const fe = dec(a[2], this.world) as EnumItem;
        const f = FONT_ENUM_FACE[fe?.n ?? 'SourceSans'] ?? FONT_ENUM_FACE.SourceSans;
        const frame = dec(a[3], this.world) as Vector2 | null;
        const m = this.host.measureText(str(0), Number(a[1]) || 14, font(f[0], f[1], f[2]), frame ? frame.x : null);
        return enc(v2(frame ? Math.min(m.w, frame.x) : m.w, m.h));
      }
      case 'LoadModule': {
        if (inst.className !== 'ModuleScript') throw new Error('Attempted to call require with invalid argument(s).');
        return this.loadModule(inst);
      }
      case 'GetValue': return ease(Number(a[0]), str(1), str(2));
      case 'Create': return this.createTween(a);
    }
    throw new Error(`${method} is not a valid member of ${inst.className} "${inst.fullName()}"`);
  }

  private createTween(a: Wire[]) {
    const target = this.inst(Number(a[0]));
    const goals = new Map<string, Value>();
    for (let i = 7; i + 1 < a.length; i += 2) {
      const key = String(a[i]);
      const v = dec(a[i + 1], this.world);
      const cur = target.get(key);
      if (cur === undefined) throw new Error(`TweenService:Create no property named '${key}' for object '${target.name}'`);
      const ok = typeOf(cur) === typeOf(v) || (typeof cur === 'number' && typeof v === 'number');
      if (!ok || typeof v === 'string' || (v && typeof v === 'object' && v.t === 'Ref')) {
        throw new Error(`TweenService:Create property named '${key}' cannot be tweened due to type mismatch (property is a '${wireTypeName(cur)}', but given type is '${wireTypeName(v)}')`);
      }
      goals.set(key, v);
    }
    const tween = this.world.create('Tween', 'Tween');
    this.tweens.create(tween, target, {
      time: Math.max(0, Number(a[1]) || 0), style: String(a[2]), dir: String(a[3]), repeat: Number(a[4]) || 0, reverses: a[5] === true, delay: Math.max(0, Number(a[6]) || 0),
    }, goals);
    return encInst(tween);
  }

  // ---------- input (called by the canvas; x/y are viewport pixels) ----------

  /** Topmost-first hits -> objects that receive hover: everything above the first sinking object, plus its ancestors. */
  private hoverSet(hits: Inst[]): Inst[] {
    const out: Inst[] = [];
    let sink: Inst | null = null;
    for (const h of hits) {
      if (h.get('Interactable') === false) continue;
      if (sink && !sink.isDescendantOf(h)) continue;
      out.push(h);
      if (!sink && (isButton(h.className) || h.className === 'TextBox' || h.get('Active') === true)) sink = h;
    }
    return out;
  }

  private io(type: string, state: string, key = 'Unknown', dz = 0) {
    return encInput(key, type, state, this.mousePos.x, this.mousePos.y - this.host.topInset, dz);
  }

  pointerMove(x: number, y: number, hits: Inst[], touch = false) {
    const gy = y - this.host.topInset;
    const dx = x - this.mousePos.x, dy = y - this.mousePos.y;
    this.mousePos = { x, y };
    this.lastInputType = touch ? 'Touch' : 'MouseMovement';
    const next = this.hoverSet(hits);
    const prev = new Set(this.hovered);
    const type = touch ? 'Touch' : 'MouseMovement';
    for (const h of next) {
      if (!prev.has(h)) {
        this.enqueue(h, 'MouseEnter', [x, gy]);
        this.enqueue(h, 'InputBegan', [this.io(type, 'Begin')]);
        if (isButton(h.className)) this.host.visualChanged(h);
      } else {
        this.enqueue(h, 'MouseMoved', [x, gy]);
        this.enqueue(h, 'InputChanged', [this.io(type, 'Change')]);
      }
      prev.delete(h);
    }
    for (const h of prev) {
      this.enqueue(h, 'MouseLeave', [x, gy]);
      this.enqueue(h, 'InputEnded', [this.io(type, 'End')]);
      if (isButton(h.className)) this.host.visualChanged(h);
    }
    this.hovered = next;
    if (this.has(this.uis, 'InputChanged')) {
      this.enqueue(this.uis, 'InputChanged', [encInput('Unknown', type, 'Change', x, gy, 0, dx, dy, 0), false]);
    }
    this.mouse.set('X', x);
    this.mouse.set('Y', gy);
    this.enqueue(this.mouse, 'Move');
    this.flush();
  }

  pointerDown(x: number, y: number, hits: Inst[], button = 0, touch = false) {
    this.pointerMove(x, y, hits, touch);
    this.buttonsDown.add(button);
    const type = touch ? 'Touch' : button === 2 ? 'MouseButton2' : button === 1 ? 'MouseButton3' : 'MouseButton1';
    this.lastInputType = type;
    const target = this.hovered.find((h) => isButton(h.className) || h.className === 'TextBox' || h.get('Active') === true);
    const btn = target && isButton(target.className) ? target : null;
    for (const h of this.hovered) this.enqueue(h, 'InputBegan', [this.io(type, 'Begin')]);
    const gy = y - this.host.topInset;
    if (btn && button !== 1) {
      this.pressed = btn;
      this.enqueue(btn, button === 2 ? 'MouseButton2Down' : 'MouseButton1Down', [x, gy]);
      this.host.visualChanged(btn);
    }
    this.enqueue(this.uis, 'InputBegan', [this.io(type, 'Begin'), !!target]);
    this.enqueue(this.mouse, button === 2 ? 'Button2Down' : 'Button1Down');
    this.flush();
  }

  pointerUp(x: number, y: number, hits: Inst[], button = 0, touch = false) {
    this.pointerMove(x, y, hits, touch);
    this.buttonsDown.delete(button);
    const type = touch ? 'Touch' : button === 2 ? 'MouseButton2' : button === 1 ? 'MouseButton3' : 'MouseButton1';
    const gy = y - this.host.topInset;
    for (const h of this.hovered) this.enqueue(h, 'InputEnded', [this.io(type, 'End')]);
    const btn = this.pressed;
    this.pressed = null;
    if (btn) {
      const over = this.hovered.includes(btn);
      if (button === 2) {
        if (over) { this.enqueue(btn, 'MouseButton2Up', [x, gy]); this.enqueue(btn, 'MouseButton2Click'); }
      } else if (over) {
        this.enqueue(btn, 'MouseButton1Up', [x, gy]);
        this.enqueue(btn, 'MouseButton1Click');
        this.enqueue(btn, 'Activated', [this.io(type, 'End'), 1]);
      }
      this.host.visualChanged(btn);
    }
    this.enqueue(this.uis, 'InputEnded', [this.io(type, 'End'), !!btn]);
    this.enqueue(this.mouse, button === 2 ? 'Button2Up' : 'Button1Up');
    this.flush();
  }

  pointerLeave() { this.pointerMove(-1, -1, []); }

  wheel(x: number, y: number, hits: Inst[], deltaY: number) {
    const gy = y - this.host.topInset;
    const dir = deltaY < 0 ? 1 : -1;
    for (const h of this.hoverSet(hits)) this.enqueue(h, dir > 0 ? 'MouseWheelForward' : 'MouseWheelBackward', [x, gy]);
    this.enqueue(this.uis, 'InputChanged', [this.io('MouseWheel', 'Change', 'Unknown', dir), false]);
    this.enqueue(this.mouse, dir > 0 ? 'WheelForward' : 'WheelBackward');
    this.flush();
  }

  key(code: string, down: boolean) {
    const kc = keyCodeOf(code);
    if (down) { if (this.keysDown.has(kc)) return; this.keysDown.add(kc); } else this.keysDown.delete(kc);
    this.lastInputType = 'Keyboard';
    this.enqueue(this.uis, down ? 'InputBegan' : 'InputEnded', [this.io('Keyboard', down ? 'Begin' : 'End', kc), this.focused !== null]);
    this.flush();
  }

  textFocus(inst: Inst, focused: boolean, enterPressed = false) {
    if (focused) {
      if (this.focused === inst) return;
      this.focused = inst;
      if (inst.get('ClearTextOnFocus') !== false) inst.set('Text', '');
      this.enqueue(inst, 'Focused');
      this.enqueue(this.uis, 'TextBoxFocused', [encInst(inst)]);
    } else {
      if (this.focused !== inst) return;
      this.focused = null;
      this.enqueue(inst, 'FocusLost', [enterPressed, this.io(enterPressed ? 'Keyboard' : 'MouseButton1', 'Begin', enterPressed ? 'Return' : 'Unknown')]);
      this.enqueue(this.uis, 'TextBoxFocusReleased', [encInst(inst)]);
    }
    this.flush();
  }

  textInput(inst: Inst, text: string) {
    inst.set('Text', text);
    this.flush();
  }

  scrolled(inst: Inst, x: number, y: number) {
    inst.set('CanvasPosition', v2(x, y));
    this.flush();
  }

  visualState(inst: Inst): 'press' | 'hover' | null {
    if (this.pressed === inst && this.hovered.includes(inst)) return 'press';
    return this.hovered.includes(inst) ? 'hover' : null;
  }

  /** Classes with events, for tests and tooling. */
  static eventsOf = eventsOf;
}

function cleanError(msg: string) {
  return msg.replace(/^(runtime|syntax) error: /, '');
}
