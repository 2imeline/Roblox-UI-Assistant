// Parser/serializer for the Lua literal expressions used as property values in .rblxui files,
// e.g. `UDim2.new(0.5, -100, 0.8, 0)`, `Color3.fromRGB(30, 30, 40)`, `Enum.Font.GothamBold`, `"Play"`.
// Only constructors and literals are accepted, never arbitrary code, so re-serializing a parsed value
// is safe to paste into Studio.
import { FONT_ENUM_FACE } from './enums';
import {
  type Color3, type Value, type Vector2, c3, cseq, en, font, nrange, nseq, rect, rgb, udim, udim2, v2, v3,
} from './values';

export class LiteralError extends Error {}

type Tok = { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'name'; v: string } | { k: 'p'; v: string } | { k: 'eof' };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '-' && src[i + 1] === '-') throw new LiteralError('comments are not allowed in property values');
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:[0-9][0-9_]*\.?[0-9_]*|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9]+)?)/.exec(src.slice(i))!;
      const raw = m[0].replace(/_/g, '');
      const v = /^0[bB]/.test(raw) ? parseInt(raw.slice(2), 2) : Number(raw);
      if (Number.isNaN(v)) throw new LiteralError(`bad number '${m[0]}'`);
      out.push({ k: 'num', v });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: 'name', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const [s, end] = readString(src, i);
      out.push({ k: 'str', v: s });
      i = end;
      continue;
    }
    if (ch === '[' && /^\[=*\[/.test(src.slice(i))) {
      const open = /^\[(=*)\[/.exec(src.slice(i))!;
      const close = `]${open[1]}]`;
      const start = i + open[0].length;
      const end = src.indexOf(close, start);
      if (end < 0) throw new LiteralError('unfinished long string');
      out.push({ k: 'str', v: src.slice(start, end).replace(/^\r?\n/, '') });
      i = end + close.length;
      continue;
    }
    if ('(){},;.+-*/%'.includes(ch)) { out.push({ k: 'p', v: ch }); i++; continue; }
    throw new LiteralError(`unexpected '${ch}'`);
  }
  out.push({ k: 'eof' });
  return out;
}

function readString(src: string, start: number): [string, number] {
  const q = src[start];
  let i = start + 1;
  const bytes: number[] = [];
  const enc = new TextEncoder();
  const pushStr = (s: string) => { for (const b of enc.encode(s)) bytes.push(b); };
  while (i < src.length) {
    const ch = src[i];
    if (ch === q) return [new TextDecoder().decode(new Uint8Array(bytes)), i + 1];
    if (ch === '\n') break;
    if (ch !== '\\') {
      const cp = src.codePointAt(i)!;
      pushStr(String.fromCodePoint(cp));
      i += cp > 0xffff ? 2 : 1;
      continue;
    }
    const e = src[i + 1];
    i += 2;
    const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };
    if (e in simple) { pushStr(simple[e]); continue; }
    if (e === 'x') { bytes.push(parseInt(src.slice(i, i + 2), 16)); i += 2; continue; }
    if (e === 'z') { while (/\s/.test(src[i] ?? '')) i++; continue; }
    if (e === 'u') {
      const m = /^\{([0-9a-fA-F]+)\}/.exec(src.slice(i));
      if (!m) throw new LiteralError('bad \\u escape');
      pushStr(String.fromCodePoint(parseInt(m[1], 16)));
      i += m[0].length;
      continue;
    }
    if (/[0-9]/.test(e)) {
      const m = /^[0-9]{1,3}/.exec(src.slice(i - 1))!;
      bytes.push(Number(m[0]) & 255);
      i += m[0].length - 1;
      continue;
    }
    throw new LiteralError(`bad escape '\\${e}'`);
  }
  throw new LiteralError('unfinished string');
}

type Arg = Value | Arg[];

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  isP(v: string) { const t = this.peek(); return t.k === 'p' && t.v === v; }
  expectP(v: string) { if (!this.isP(v)) throw new LiteralError(`expected '${v}'`); this.i++; }

  expr(): Arg {
    let left = this.term();
    while (this.isP('+') || this.isP('-')) {
      const op = (this.next() as { v: string }).v;
      left = arith(op, left, this.term());
    }
    return left;
  }
  term(): Arg {
    let left = this.unary();
    while (this.isP('*') || this.isP('/') || this.isP('%')) {
      const op = (this.next() as { v: string }).v;
      left = arith(op, left, this.unary());
    }
    return left;
  }
  unary(): Arg {
    if (this.isP('-')) { this.i++; return arith('-', 0, this.unary()); }
    return this.primary();
  }
  primary(): Arg {
    const t = this.next();
    if (t.k === 'num' || t.k === 'str') return t.v;
    if (t.k === 'p' && t.v === '(') { const v = this.expr(); this.expectP(')'); return v; }
    if (t.k === 'p' && t.v === '{') {
      const items: Arg[] = [];
      while (!this.isP('}')) {
        items.push(this.expr());
        if (this.isP(',') || this.isP(';')) this.i++;
        else break;
      }
      this.expectP('}');
      return items;
    }
    if (t.k === 'name') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'nil') return null;
      const path = [t.v];
      while (this.isP('.')) {
        this.i++;
        const n = this.next();
        if (n.k !== 'name') throw new LiteralError('expected name after "."');
        path.push(n.v);
      }
      const name = path.join('.');
      if (this.isP('(')) {
        this.i++;
        const args: Arg[] = [];
        while (!this.isP(')')) {
          args.push(this.expr());
          if (this.isP(',')) this.i++;
          else break;
        }
        this.expectP(')');
        return construct(name, args);
      }
      return constant(name, path);
    }
    throw new LiteralError('unexpected token');
  }
}

function arith(op: string, a: Arg, b: Arg): Arg {
  if (typeof a === 'number' && typeof b === 'number') {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
      case '%': return a - Math.floor(a / b) * b;
    }
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b) && a.t === b.t && (op === '+' || op === '-')) {
    const s = op === '+' ? 1 : -1;
    if (a.t === 'UDim2' && b.t === 'UDim2') return udim2(a.xs + s * b.xs, a.xo + s * b.xo, a.ys + s * b.ys, a.yo + s * b.yo);
    if (a.t === 'UDim' && b.t === 'UDim') return udim(a.s + s * b.s, a.o + s * b.o);
    if (a.t === 'Vector2' && b.t === 'Vector2') return v2(a.x + s * b.x, a.y + s * b.y);
  }
  throw new LiteralError(`unsupported arithmetic '${op}'`);
}

function constant(name: string, path: string[]): Value {
  if (path[0] === 'Enum' && path.length === 3) return en(path[1], path[2]);
  switch (name) {
    case 'math.huge': return Infinity;
    case 'math.pi': return Math.PI;
    case 'Vector2.zero': return v2(0, 0);
    case 'Vector2.one': return v2(1, 1);
    case 'Vector2.xAxis': return v2(1, 0);
    case 'Vector2.yAxis': return v2(0, 1);
    case 'Vector3.zero': return v3(0, 0, 0);
    case 'Vector3.one': return v3(1, 1, 1);
  }
  throw new LiteralError(`unknown value '${name}'`);
}

const num = (a: Arg | undefined, d = 0): number => {
  if (a === undefined || a === null) return d;
  if (typeof a !== 'number') throw new LiteralError('expected a number');
  return a;
};
const color = (a: Arg | undefined): Color3 => {
  if (!a || typeof a !== 'object' || Array.isArray(a) || a.t !== 'Color3') throw new LiteralError('expected a Color3');
  return a;
};

function hsv(h: number, s: number, v: number): Color3 {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return c3(m[0], m[1], m[2]);
}

function construct(name: string, a: Arg[]): Value {
  switch (name) {
    case 'UDim.new': return udim(num(a[0]), num(a[1]));
    case 'UDim2.new':
      if (a.length === 2 && typeof a[0] === 'object' && a[0] && !Array.isArray(a[0]) && a[0].t === 'UDim') {
        const x = a[0], y = a[1] as { s: number; o: number };
        return udim2(x.s, x.o, y.s, y.o);
      }
      return udim2(num(a[0]), num(a[1]), num(a[2]), num(a[3]));
    case 'UDim2.fromScale': return udim2(num(a[0]), 0, num(a[1]), 0);
    case 'UDim2.fromOffset': return udim2(0, num(a[0]), 0, num(a[1]));
    case 'Vector2.new': return v2(num(a[0]), num(a[1]));
    case 'Vector3.new': return v3(num(a[0]), num(a[1]), num(a[2]));
    case 'Color3.new': return c3(num(a[0]), num(a[1]), num(a[2]));
    case 'Color3.fromRGB': return rgb(num(a[0]), num(a[1]), num(a[2]));
    case 'Color3.fromHSV': return hsv(num(a[0]), num(a[1]), num(a[2]));
    case 'Color3.fromHex': {
      const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(String(a[0]));
      if (!m) throw new LiteralError('bad hex color');
      const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
      return rgb(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
    }
    case 'Rect.new':
      if (a.length === 2) { const p = a[0] as Vector2, q = a[1] as Vector2; return rect(p.x, p.y, q.x, q.y); }
      return rect(num(a[0]), num(a[1]), num(a[2]), num(a[3]));
    case 'NumberRange.new': return nrange(num(a[0]), num(a[1], num(a[0])));
    case 'ColorSequenceKeypoint.new': return { t: 'Kp', time: num(a[0]), c: color(a[1]) } as unknown as Value;
    case 'NumberSequenceKeypoint.new': return { t: 'NKp', time: num(a[0]), v: num(a[1]), e: num(a[2]) } as unknown as Value;
    case 'ColorSequence.new': {
      if (Array.isArray(a[0])) {
        const k = a[0].map((p) => {
          const kp = p as unknown as { t: string; time: number; c: Color3 };
          if (!kp || kp.t !== 'Kp') throw new LiteralError('expected ColorSequenceKeypoint');
          return { time: kp.time, c: kp.c };
        });
        if (k.length < 2) throw new LiteralError('ColorSequence needs at least 2 keypoints');
        return cseq(k);
      }
      const c0 = color(a[0]), c1 = a[1] === undefined ? c0 : color(a[1]);
      return cseq([{ time: 0, c: c0 }, { time: 1, c: c1 }]);
    }
    case 'NumberSequence.new': {
      if (Array.isArray(a[0])) {
        const k = a[0].map((p) => {
          const kp = p as unknown as { t: string; time: number; v: number; e: number };
          if (!kp || kp.t !== 'NKp') throw new LiteralError('expected NumberSequenceKeypoint');
          return { time: kp.time, v: kp.v, e: kp.e };
        });
        if (k.length < 2) throw new LiteralError('NumberSequence needs at least 2 keypoints');
        return nseq(k);
      }
      const n0 = num(a[0]), n1 = num(a[1], n0);
      return nseq([{ time: 0, v: n0, e: 0 }, { time: 1, v: n1, e: 0 }]);
    }
    case 'Font.new': {
      const w = a[1] as { t: string; n: string } | undefined;
      const s = a[2] as { t: string; n: string } | undefined;
      return font(String(a[0]), weightOf(w?.n), s?.n === 'Italic' ? 'Italic' : 'Normal');
    }
    case 'Font.fromName': {
      const w = a[1] as { n: string } | undefined, s = a[2] as { n: string } | undefined;
      return font(`rbxasset://fonts/families/${String(a[0])}.json`, weightOf(w?.n), s?.n === 'Italic' ? 'Italic' : 'Normal');
    }
    case 'Font.fromEnum': {
      const e = a[0] as { t: string; n: string };
      const f = FONT_ENUM_FACE[e?.n];
      if (!f) throw new LiteralError('unknown Enum.Font');
      return font(f[0], f[1], f[2]);
    }
  }
  throw new LiteralError(`unknown constructor '${name}'`);
}

const WEIGHTS: Record<string, number> = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Heavy: 900 };
const weightOf = (n?: string) => (n ? WEIGHTS[n] ?? 400 : 400);
export const weightName = (w: number) => Object.entries(WEIGHTS).reduce((best, [k, v]) => (Math.abs(v - w) < Math.abs(WEIGHTS[best] - w) ? k : best), 'Regular');

export function parseLiteral(src: string): Value {
  const p = new Parser(lex(src));
  const v = p.expr();
  if (p.peek().k !== 'eof') throw new LiteralError('unexpected trailing input');
  if (Array.isArray(v) || (v && typeof v === 'object' && (v.t as string).endsWith('Kp'))) throw new LiteralError('not a property value');
  return v;
}

// ---------- serialization ----------

export function fmtNum(n: number): string {
  if (Number.isNaN(n)) return '0/0';
  if (n === Infinity) return 'math.huge';
  if (n === -Infinity) return '-math.huge';
  const r = Math.abs(n) < 1e15 ? parseFloat(n.toFixed(6)) : n;
  return Object.is(r, -0) ? '0' : String(r);
}

export function luaString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    // Three digits, so a digit that follows is not read as part of the escape.
    else if (c < 32 || c === 127) out += `\\${String(c).padStart(3, '0')}`;
    else out += ch;
  }
  return out + '"';
}

const byteish = (x: number) => Math.abs(x * 255 - Math.round(x * 255)) < 1e-3;
const colorLit = (c: Color3) =>
  byteish(c.r) && byteish(c.g) && byteish(c.b)
    ? `Color3.fromRGB(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`
    : `Color3.new(${fmtNum(c.r)}, ${fmtNum(c.g)}, ${fmtNum(c.b)})`;

export function toLiteral(v: Value): string {
  if (v === null) return 'nil';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return luaString(v);
  switch (v.t) {
    case 'UDim': return `UDim.new(${fmtNum(v.s)}, ${fmtNum(v.o)})`;
    case 'UDim2': return `UDim2.new(${fmtNum(v.xs)}, ${fmtNum(v.xo)}, ${fmtNum(v.ys)}, ${fmtNum(v.yo)})`;
    case 'Vector2': return `Vector2.new(${fmtNum(v.x)}, ${fmtNum(v.y)})`;
    case 'Vector3': return `Vector3.new(${fmtNum(v.x)}, ${fmtNum(v.y)}, ${fmtNum(v.z)})`;
    case 'Color3': return colorLit(v);
    case 'Rect': return `Rect.new(${fmtNum(v.x0)}, ${fmtNum(v.y0)}, ${fmtNum(v.x1)}, ${fmtNum(v.y1)})`;
    case 'NumberRange': return `NumberRange.new(${fmtNum(v.min)}, ${fmtNum(v.max)})`;
    case 'Enum': return `Enum.${v.e}.${v.n}`;
    case 'Font': return `Font.new(${luaString(v.family)}, Enum.FontWeight.${weightName(v.weight)}, Enum.FontStyle.${v.style})`;
    case 'ColorSequence': {
      const k = v.k;
      if (k.length === 2 && k[0].time === 0 && k[1].time === 1) {
        const a = colorLit(k[0].c), b = colorLit(k[1].c);
        return a === b ? `ColorSequence.new(${a})` : `ColorSequence.new(${a}, ${b})`;
      }
      return `ColorSequence.new({${k.map((p) => `ColorSequenceKeypoint.new(${fmtNum(p.time)}, ${colorLit(p.c)})`).join(', ')}})`;
    }
    case 'NumberSequence': {
      const k = v.k;
      if (k.length === 2 && k[0].time === 0 && k[1].time === 1 && !k[0].e && !k[1].e) {
        return k[0].v === k[1].v ? `NumberSequence.new(${fmtNum(k[0].v)})` : `NumberSequence.new(${fmtNum(k[0].v)}, ${fmtNum(k[1].v)})`;
      }
      return `NumberSequence.new({${k.map((p) => `NumberSequenceKeypoint.new(${fmtNum(p.time)}, ${fmtNum(p.v)}${p.e ? ', ' + fmtNum(p.e) : ''})`).join(', ')}})`;
    }
    case 'Ref': return 'nil';
  }
}
