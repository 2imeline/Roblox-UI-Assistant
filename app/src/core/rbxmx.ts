// .rbxmx (Roblox XML model) export, for drag-and-drop import into Studio.
import { pinnedProps } from './classes';
import { enumValue } from './enums';
import type { Inst } from './instance';
import type { Value } from './values';

const INT_PROPS = new Set(['ZIndex', 'LayoutOrder', 'BorderSizePixel', 'ScrollBarThickness', 'DisplayOrder', 'MaxVisibleGraphemes',
  'FillDirectionMaxCells', 'MinTextSize', 'MaxTextSize', 'CursorPosition', 'SelectionStart']);
const CONTENT_PROPS = new Set(['Image', 'HoverImage', 'PressedImage', 'SoundId', 'Video']);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const cdata = (s: string) => `<![CDATA[${s.split(']]>').join(']]]]><![CDATA[>')}]]>`;
const n = (x: number) => (Number.isFinite(x) ? String(+x.toPrecision(9)) : x > 0 ? 'INF' : x < 0 ? '-INF' : 'NAN');

function propXml(cls: string, key: string, v: Value): string | null {
  const nm = `name="${esc(key)}"`;
  if (typeof v === 'boolean') return `<bool ${nm}>${v}</bool>`;
  if (typeof v === 'number') {
    if (cls === 'IntValue' && key === 'Value') return `<int64 ${nm}>${Math.round(v)}</int64>`;
    return INT_PROPS.has(key) ? `<int ${nm}>${Math.round(v)}</int>` : `<float ${nm}>${n(v)}</float>`;
  }
  if (typeof v === 'string') {
    if (key === 'Source') return `<ProtectedString ${nm}>${cdata(v)}</ProtectedString>`;
    if (CONTENT_PROPS.has(key)) return v ? `<Content ${nm}><url>${esc(v)}</url></Content>` : `<Content ${nm}><null></null></Content>`;
    return `<string ${nm}>${esc(v)}</string>`;
  }
  if (v === null) return null;
  switch (v.t) {
    case 'UDim': return `<UDim ${nm}><S>${n(v.s)}</S><O>${Math.round(v.o)}</O></UDim>`;
    case 'UDim2': return `<UDim2 ${nm}><XS>${n(v.xs)}</XS><XO>${Math.round(v.xo)}</XO><YS>${n(v.ys)}</YS><YO>${Math.round(v.yo)}</YO></UDim2>`;
    case 'Vector2': return `<Vector2 ${nm}><X>${n(v.x)}</X><Y>${n(v.y)}</Y></Vector2>`;
    case 'Vector3': return `<Vector3 ${nm}><X>${n(v.x)}</X><Y>${n(v.y)}</Y><Z>${n(v.z)}</Z></Vector3>`;
    case 'Color3': return `<Color3 ${nm}><R>${n(v.r)}</R><G>${n(v.g)}</G><B>${n(v.b)}</B></Color3>`;
    case 'Rect': return `<Rect2D ${nm}><min><X>${n(v.x0)}</X><Y>${n(v.y0)}</Y></min><max><X>${n(v.x1)}</X><Y>${n(v.y1)}</Y></max></Rect2D>`;
    case 'NumberRange': return `<NumberRange ${nm}>${n(v.min)} ${n(v.max)} </NumberRange>`;
    case 'Enum': {
      const val = enumValue(v.e, v.n);
      return val === undefined ? null : `<token ${nm}>${val}</token>`;
    }
    case 'Font': return `<Font ${nm}><Family><url>${esc(v.family)}</url></Family><Weight>${v.weight}</Weight><Style>${v.style}</Style></Font>`;
    case 'ColorSequence': return `<ColorSequence ${nm}>${v.k.map((p) => `${n(p.time)} ${n(p.c.r)} ${n(p.c.g)} ${n(p.c.b)} 0 `).join('')}</ColorSequence>`;
    case 'NumberSequence': return `<NumberSequence ${nm}>${v.k.map((p) => `${n(p.time)} ${n(p.v)} ${n(p.e)} `).join('')}</NumberSequence>`;
    case 'Ref': return null;
  }
}

/** Roblox's binary attribute blob (AttributesSerialize). Supports the common types; others are skipped. */
export function encodeAttributes(attrs: Map<string, Value>): Uint8Array | null {
  const out: number[] = [];
  const dv = new DataView(new ArrayBuffer(8));
  const u32 = (x: number) => { dv.setUint32(0, x, true); out.push(...new Uint8Array(dv.buffer, 0, 4)); };
  const i32 = (x: number) => { dv.setInt32(0, x, true); out.push(...new Uint8Array(dv.buffer, 0, 4)); };
  const f32 = (x: number) => { dv.setFloat32(0, x, true); out.push(...new Uint8Array(dv.buffer, 0, 4)); };
  const f64 = (x: number) => { dv.setFloat64(0, x, true); out.push(...new Uint8Array(dv.buffer, 0, 8)); };
  const str = (s: string) => { const b = new TextEncoder().encode(s); u32(b.length); out.push(...b); };
  const entries = [...attrs].filter(([, v]) => v !== null && (typeof v !== 'object' || ['UDim', 'UDim2', 'Color3', 'Vector2', 'Vector3', 'NumberRange', 'Rect'].includes(v.t)));
  if (!entries.length) return null;
  u32(entries.length);
  for (const [k, v] of entries) {
    str(k);
    if (typeof v === 'string') { out.push(0x02); str(v); }
    else if (typeof v === 'boolean') { out.push(0x03, v ? 1 : 0); }
    else if (typeof v === 'number') { out.push(0x06); f64(v); }
    else if (v && typeof v === 'object') {
      switch (v.t) {
        case 'UDim': out.push(0x09); f32(v.s); i32(v.o); break;
        case 'UDim2': out.push(0x0a); f32(v.xs); i32(v.xo); f32(v.ys); i32(v.yo); break;
        case 'Color3': out.push(0x0f); f32(v.r); f32(v.g); f32(v.b); break;
        case 'Vector2': out.push(0x10); f32(v.x); f32(v.y); break;
        case 'Vector3': out.push(0x11); f32(v.x); f32(v.y); f32(v.z); break;
        case 'NumberRange': out.push(0x1b); f32(v.min); f32(v.max); break;
        case 'Rect': out.push(0x1c); f32(v.x0); f32(v.y0); f32(v.x1); f32(v.y1); break;
      }
    }
  }
  return new Uint8Array(out);
}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

export function generateRbxmx(root: Inst): string {
  let ref = 0;
  const item = (inst: Inst, depth: number): string => {
    const pad = '  '.repeat(depth);
    const props: string[] = [`<string name="Name">${esc(inst.name)}</string>`];
    const keys = new Set([...pinnedProps(inst.className).filter((k) => inst.get(k) !== undefined), ...inst.props.keys()]);
    for (const k of keys) {
      const x = propXml(inst.className, k, inst.get(k)!);
      if (x) props.push(x);
    }
    if (inst.className.endsWith('Script') && !inst.props.has('Source')) props.push(`<ProtectedString name="Source">${cdata(String(inst.get('Source') ?? ''))}</ProtectedString>`);
    const attrs = encodeAttributes(inst.attrs);
    if (attrs) props.push(`<BinaryString name="AttributesSerialize">${b64(attrs)}</BinaryString>`);
    const kids = inst.children.map((c) => item(c, depth + 1)).join('');
    return `${pad}<Item class="${esc(inst.className)}" referent="RBX${(ref++).toString(16).toUpperCase().padStart(8, '0')}">\n${pad}  <Properties>\n${props.map((p) => `${pad}    ${p}\n`).join('')}${pad}  </Properties>\n${kids}${pad}</Item>\n`;
  };
  return `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n${item(root, 1)}</roblox>\n`;
}
