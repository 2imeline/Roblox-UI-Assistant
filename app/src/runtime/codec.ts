// Wire format between JS and the Luau prelude (must match enc/dec in prelude.luau):
// primitives pass as-is; everything else is a string "\x01TAG|field|field...".
import type { Inst, World } from '../core/instance';
import { type Value, c3, cseq, en, font, nrange, nseq, rect, udim, udim2, v2, v3 } from '../core/values';

export type Wire = string | number | boolean | null | undefined;

const S = '\x01';
const n = (x: number) => (x === Infinity ? '1e999' : x === -Infinity ? '-1e999' : Number.isNaN(x) ? 'nan' : String(x));
const num = (s: string) => (s === 'inf' ? Infinity : s === '-inf' ? -Infinity : Number(s));

export const encInst = (i: Inst | null | undefined): Wire => (i && !i.destroyed ? `${S}I|${i.id}|${i.className}` : null);
export const encError = (msg: string) => `${S}x|${msg}`;
export const encList = (list: Inst[]) => `${S}L|${list.map((i) => `${i.id}|${i.className}`).join('|')}`;
export const NOOP = `${S}N`;
export const encAnything = (path: string) => `${S}A|${path}`;

export function enc(v: Value | undefined): Wire {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.charCodeAt(0) === 1 ? `${S}s|${v}` : v;
  if (typeof v !== 'object') return v;
  switch (v.t) {
    case 'UDim2': return `${S}U2|${n(v.xs)}|${n(v.xo)}|${n(v.ys)}|${n(v.yo)}`;
    case 'UDim': return `${S}U|${n(v.s)}|${n(v.o)}`;
    case 'Vector2': return `${S}V2|${n(v.x)}|${n(v.y)}`;
    case 'Vector3': return `${S}V3|${n(v.x)}|${n(v.y)}|${n(v.z)}`;
    case 'Color3': return `${S}C3|${n(v.r)}|${n(v.g)}|${n(v.b)}`;
    case 'Enum': return `${S}E|${v.e}|${v.n}`;
    case 'Rect': return `${S}R|${n(v.x0)}|${n(v.y0)}|${n(v.x1)}|${n(v.y1)}`;
    case 'NumberRange': return `${S}NR|${n(v.min)}|${n(v.max)}`;
    case 'Font': return `${S}F|${v.family}|${v.weight}|${v.style}`;
    case 'ColorSequence': return `${S}CS|${v.k.map((k) => `${n(k.time)}|${n(k.c.r)}|${n(k.c.g)}|${n(k.c.b)}`).join('|')}`;
    case 'NumberSequence': return `${S}NS|${v.k.map((k) => `${n(k.time)}|${n(k.v)}|${n(k.e)}`).join('|')}`;
    case 'Ref': return encInst(v.inst);
  }
}

export class DecodeError extends Error {}

/** Decodes a wire value; instances become Ref values. */
export function dec(x: unknown, world: World): Value {
  if (x === undefined || x === null) return null;
  if (typeof x === 'number' || typeof x === 'boolean') return x;
  if (typeof x !== 'string') throw new DecodeError(typeof x === 'object' && x && 'type' in x ? String((x as { type: string }).type) : typeof x);
  if (x.charCodeAt(0) !== 1) return x;
  const bar = x.indexOf('|');
  const tag = x.slice(1, bar < 0 ? undefined : bar);
  if (tag === 's') return x.slice(3);
  if (tag === '?') throw new DecodeError(x.slice(3));
  const p = x.slice(bar + 1).split('|');
  const f = (i: number) => num(p[i]);
  switch (tag) {
    case 'I': {
      const inst = world.byId.get(Number(p[0]));
      return { t: 'Ref', inst: inst ?? null };
    }
    case 'U2': return udim2(f(0), f(1), f(2), f(3));
    case 'U': return udim(f(0), f(1));
    case 'V2': return v2(f(0), f(1));
    case 'V3': return v3(f(0), f(1), f(2));
    case 'C3': return c3(f(0), f(1), f(2));
    case 'E': return en(p[0], p[1]);
    case 'R': return rect(f(0), f(1), f(2), f(3));
    case 'NR': return nrange(f(0), f(1));
    case 'F': return font(p[0], f(1), p[2] === 'Italic' ? 'Italic' : 'Normal');
    case 'CS': {
      const k = [];
      for (let i = 0; i + 3 < p.length; i += 4) k.push({ time: f(i), c: c3(f(i + 1), f(i + 2), f(i + 3)) });
      return cseq(k);
    }
    case 'NS': {
      const k = [];
      for (let i = 0; i + 2 < p.length; i += 3) k.push({ time: f(i), v: f(i + 1), e: f(i + 2) });
      return nseq(k);
    }
  }
  throw new DecodeError(`unknown value tag ${tag}`);
}

/** Roblox type names for error messages. */
export function wireTypeName(v: Value): string {
  if (v === null) return 'nil';
  if (typeof v !== 'object') return typeof v === 'boolean' ? 'bool' : typeof v;
  return v.t === 'Ref' ? 'Instance' : v.t === 'Enum' ? 'EnumItem' : v.t;
}

/** InputObject: KeyCode|UserInputType|UserInputState|px|py|pz|dx|dy|dz */
export const encInput = (key: string, type: string, state: string, px = 0, py = 0, pz = 0, dx = 0, dy = 0, dz = 0) =>
  `${S}IO|${key}|${type}|${state}|${n(px)}|${n(py)}|${n(pz)}|${n(dx)}|${n(dy)}|${n(dz)}`;
