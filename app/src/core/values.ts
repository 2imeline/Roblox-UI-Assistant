// Roblox datatypes as plain tagged objects. Shared by the file format, layout, renderer and the Luau bridge.
import type { Inst } from './instance';

export interface UDim { t: 'UDim'; s: number; o: number }
export interface UDim2 { t: 'UDim2'; xs: number; xo: number; ys: number; yo: number }
export interface Vector2 { t: 'Vector2'; x: number; y: number }
export interface Vector3 { t: 'Vector3'; x: number; y: number; z: number }
export interface Color3 { t: 'Color3'; r: number; g: number; b: number }
export interface Rect { t: 'Rect'; x0: number; y0: number; x1: number; y1: number }
export interface NumberRange { t: 'NumberRange'; min: number; max: number }
export interface EnumItem { t: 'Enum'; e: string; n: string }
export interface Font { t: 'Font'; family: string; weight: number; style: 'Normal' | 'Italic' }
export interface ColorSequence { t: 'ColorSequence'; k: { time: number; c: Color3 }[] }
export interface NumberSequence { t: 'NumberSequence'; k: { time: number; v: number; e: number }[] }
/** Reference to another instance (ObjectValue.Value etc.). Runtime only, never written to files. */
export interface Ref { t: 'Ref'; inst: Inst | null }

export type DataType = UDim | UDim2 | Vector2 | Vector3 | Color3 | Rect | NumberRange | EnumItem | Font | ColorSequence | NumberSequence | Ref;
export type Value = null | boolean | number | string | DataType;

// Roblox stores UDim offsets as int32.
export const udim = (s: number, o: number): UDim => ({ t: 'UDim', s, o: Math.round(o) });
export const udim2 = (xs: number, xo: number, ys: number, yo: number): UDim2 => ({ t: 'UDim2', xs, xo: Math.round(xo), ys, yo: Math.round(yo) });
export const v2 = (x: number, y: number): Vector2 => ({ t: 'Vector2', x, y });
export const v3 = (x: number, y: number, z: number): Vector3 => ({ t: 'Vector3', x, y, z });
export const c3 = (r: number, g: number, b: number): Color3 => ({ t: 'Color3', r, g, b });
export const rgb = (r: number, g: number, b: number): Color3 => c3(r / 255, g / 255, b / 255);
export const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ t: 'Rect', x0, y0, x1, y1 });
export const nrange = (min: number, max = min): NumberRange => ({ t: 'NumberRange', min, max });
export const en = (e: string, n: string): EnumItem => ({ t: 'Enum', e, n });
export const font = (family: string, weight = 400, style: 'Normal' | 'Italic' = 'Normal'): Font => ({ t: 'Font', family, weight, style });
export const cseq = (k: { time: number; c: Color3 }[]): ColorSequence => ({ t: 'ColorSequence', k });
export const nseq = (k: { time: number; v: number; e: number }[]): NumberSequence => ({ t: 'NumberSequence', k });

export function typeOf(v: Value | undefined): string {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'object') return v.t;
  return typeof v;
}

export function equals(a: Value | undefined, b: Value | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a.t !== b.t) return false;
  if (a.t === 'Ref') return a.inst === (b as Ref).inst;
  return JSON.stringify(a) === JSON.stringify(b);
}

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

/** Linear interpolation used by TweenService. Non-interpolable types snap at the end. */
export function lerp(a: Value, b: Value, t: number): Value {
  if (typeof a === 'number' && typeof b === 'number') return lerpN(a, b, t);
  if (a && b && typeof a === 'object' && typeof b === 'object' && a.t === b.t) {
    switch (a.t) {
      case 'UDim': { const B = b as UDim; return udim(lerpN(a.s, B.s, t), lerpN(a.o, B.o, t)); }
      case 'UDim2': { const B = b as UDim2; return udim2(lerpN(a.xs, B.xs, t), lerpN(a.xo, B.xo, t), lerpN(a.ys, B.ys, t), lerpN(a.yo, B.yo, t)); }
      case 'Vector2': { const B = b as Vector2; return v2(lerpN(a.x, B.x, t), lerpN(a.y, B.y, t)); }
      case 'Vector3': { const B = b as Vector3; return v3(lerpN(a.x, B.x, t), lerpN(a.y, B.y, t), lerpN(a.z, B.z, t)); }
      case 'Color3': { const B = b as Color3; return c3(lerpN(a.r, B.r, t), lerpN(a.g, B.g, t), lerpN(a.b, B.b, t)); }
      case 'Rect': { const B = b as Rect; return rect(lerpN(a.x0, B.x0, t), lerpN(a.y0, B.y0, t), lerpN(a.x1, B.x1, t), lerpN(a.y1, B.y1, t)); }
      case 'NumberRange': { const B = b as NumberRange; return nrange(lerpN(a.min, B.min, t), lerpN(a.max, B.max, t)); }
    }
  }
  return t >= 1 ? b : a;
}

export const toByte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
export const cssColor = (c: Color3, transparency = 0) =>
  `rgba(${toByte(c.r)},${toByte(c.g)},${toByte(c.b)},${+(1 - Math.max(0, Math.min(1, transparency))).toFixed(4)})`;

/** Evaluate a ColorSequence at time t (0..1). */
export function sampleColor(s: ColorSequence, t: number): Color3 {
  const k = s.k;
  if (t <= k[0].time) return k[0].c;
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].time) {
      const a = k[i - 1], b = k[i];
      const f = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
      return lerp(a.c, b.c, f) as Color3;
    }
  }
  return k[k.length - 1].c;
}

export function sampleNumber(s: NumberSequence, t: number): number {
  const k = s.k;
  if (t <= k[0].time) return k[0].v;
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].time) {
      const a = k[i - 1], b = k[i];
      return b.time === a.time ? b.v : lerpN(a.v, b.v, (t - a.time) / (b.time - a.time));
    }
  }
  return k[k.length - 1].v;
}
