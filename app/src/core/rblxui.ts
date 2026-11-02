// .rblxui <-> instance tree.
import { isKnownClass, isScript } from './classes';
import { type Inst, World } from './instance';
import { LiteralError, parseLiteral, toLiteral } from './literal';
import { generateLua } from './luagen';
import type { Value } from './values';

export const SCHEMA = 'rblxui/1.0';

export const INSTRUCTIONS = [
  'This is a .rblxui file (schema rblxui/1.0): one Roblox ScreenGui stored as JSON, with its working Luau.',
  '`screenGui` is the instance tree, in Explorer order. Every node has `class` (Roblox ClassName; the root is always ScreenGui), `name`, and optional `properties`, `attributes`, `children` and `scripts`.',
  '`properties` maps a Roblox property name to a Lua literal expression stored as a JSON string, written exactly as you would assign it in Luau: "UDim2.new(0.5, -100, 0.8, 0)", "Color3.fromRGB(30, 30, 40)", "Enum.Font.GothamBold", "Font.new(\\"rbxasset://fonts/families/GothamSSm.json\\", Enum.FontWeight.Bold, Enum.FontStyle.Normal)", "0.25", "true", and strings with their quotes: "\\"Play\\"". Omitted properties keep their Instance.new() defaults. `attributes` uses the same literal format.',
  '`scripts` lists LocalScript / Script / ModuleScript instances parented to that node; `source` is complete, working Luau. UI behaviour (buttons, menus, tabs, tweens, hover effects) lives in these scripts.',
  '`lua` is the flat, ready-to-paste Studio command-bar script that rebuilds this ScreenGui under StarterGui. It is derived from the tree: if you change the tree, regenerate `lua` by walking the tree depth-first and, for each node, emitting Instance.new(class), one assignment per property using the literal verbatim, then setting Parent; for each script, create it, set Source to its `source` in a long string, then set Parent.',
  'When editing: keep `schema` and `instructions` as they are, keep names stable so scripts keep finding their targets, and return the whole file.',
].join('\n');

export interface ScriptDef { name: string; type: 'LocalScript' | 'Script' | 'ModuleScript'; source: string; enabled?: boolean }
export interface Component {
  class?: string;
  name: string;
  properties?: Record<string, string | number | boolean>;
  attributes?: Record<string, string | number | boolean>;
  children?: Component[];
  scripts?: ScriptDef[];
}
export interface RblxuiFile { schema: string; instructions: string; screenGui: Component; lua?: string; [extra: string]: unknown }

export interface ParseResult { root: Inst; warnings: string[]; extra: Record<string, unknown> }

/** Properties whose values are plain strings; a bare non-literal value there is accepted as text. */
const STRINGY = /^(Text|PlaceholderText|Image|HoverImage|PressedImage|SoundId|Video|Source|Value)$/;

export class RblxuiError extends Error {}

export function parseValue(prop: string, raw: unknown, where: string, warnings: string[]): Value | undefined {
  if (typeof raw === 'number' || typeof raw === 'boolean' || raw === null) return raw;
  if (typeof raw !== 'string') { warnings.push(`${where}.${prop}: expected a Lua literal string, got ${typeof raw}`); return undefined; }
  try {
    const v = parseLiteral(raw);
    if (STRINGY.test(prop) && typeof v !== 'string' && v !== null) return String(v);
    return v;
  } catch (e) {
    if (STRINGY.test(prop)) { warnings.push(`${where}.${prop}: not a Lua string literal, treated as plain text`); return raw; }
    warnings.push(`${where}.${prop}: ${(e as LiteralError).message} in ${JSON.stringify(raw)}`);
    return undefined;
  }
}

export function parseRblxui(input: string | object, world = new World()): ParseResult {
  let data: unknown = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch (e) { throw new RblxuiError(`Not valid JSON: ${(e as Error).message}`); }
  }
  if (!data || typeof data !== 'object') throw new RblxuiError('A .rblxui file must be a JSON object');
  const file = data as Partial<RblxuiFile>;
  const warnings: string[] = [];
  if (typeof file.schema !== 'string' || !file.schema.startsWith('rblxui/')) warnings.push('missing or unknown "schema" (expected "rblxui/1.0")');
  else if (file.schema.split('/')[1]?.split('.')[0] !== '1') warnings.push(`schema ${file.schema} is newer than this builder (rblxui/1.0)`);
  const sg = file.screenGui;
  if (!sg || typeof sg !== 'object') throw new RblxuiError('Missing "screenGui" object');
  const root = build({ class: 'ScreenGui', ...sg }, world, 'screenGui', warnings);
  if (root.className !== 'ScreenGui') { warnings.push(`screenGui.class must be ScreenGui (was ${root.className})`); }
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(file)) if (!['schema', 'instructions', 'screenGui', 'lua'].includes(k)) extra[k] = v;
  return { root, warnings, extra };
}

function build(c: Component, world: World, where: string, warnings: string[]): Inst {
  if (!c || typeof c !== 'object') throw new RblxuiError(`${where}: expected an object`);
  const cls = typeof c.class === 'string' && c.class ? c.class : 'Frame';
  if (!c.class) warnings.push(`${where}: missing "class", assuming Frame`);
  else if (!isKnownClass(cls)) warnings.push(`${where}: unknown class ${cls} (kept, but not rendered)`);
  const name = typeof c.name === 'string' && c.name ? c.name : cls;
  const here = `${where}(${name})`;
  const inst = world.create(cls, name);
  for (const [k, raw] of Object.entries(c.properties ?? {})) {
    if (k === 'Name' || k === 'Parent' || k === 'ClassName') continue;
    const v = parseValue(k, raw, here, warnings);
    if (v !== undefined) inst.set(k, v);
  }
  for (const [k, raw] of Object.entries(c.attributes ?? {})) {
    const v = parseValue('Attribute', raw, `${here}@${k}`, warnings);
    if (v !== undefined && v !== null) inst.attrs.set(k, v);
  }
  (c.children ?? []).forEach((ch, i) => build(ch, world, `${here}.children[${i}]`, warnings).setParent(inst));
  (c.scripts ?? []).forEach((s, i) => {
    const type = s?.type === 'Script' || s?.type === 'ModuleScript' ? s.type : 'LocalScript';
    if (s?.type && s.type !== type) warnings.push(`${here}.scripts[${i}]: unknown script type ${s.type}, using LocalScript`);
    const sc = world.create(type, s?.name || type);
    sc.set('Source', typeof s?.source === 'string' ? s.source : '');
    if (s?.enabled === false) sc.set('Enabled', false);
    sc.setParent(inst);
  });
  return inst;
}

export function toComponent(inst: Inst): Component {
  const c: Component = { class: inst.className, name: inst.name };
  if (inst.props.size) c.properties = Object.fromEntries([...inst.props].filter(([, v]) => !(v && typeof v === 'object' && v.t === 'Ref')).map(([k, v]) => [k, toLiteral(v)]));
  if (inst.attrs.size) c.attributes = Object.fromEntries([...inst.attrs].map(([k, v]) => [k, toLiteral(v)]));
  // A script with children, attributes or extra properties is written as a plain component so nothing is lost.
  const plain = (ch: Inst) => !ch.children.length && !ch.attrs.size && [...ch.props.keys()].every((k) => k === 'Source' || k === 'Enabled');
  const kids = inst.children.filter((ch) => !isScript(ch.className) || !plain(ch));
  const scripts = inst.children.filter((ch) => isScript(ch.className) && plain(ch));
  if (kids.length) c.children = kids.map(toComponent);
  if (scripts.length) {
    c.scripts = scripts.map((s) => {
      const d: ScriptDef = { name: s.name, type: s.className as ScriptDef['type'], source: String(s.get('Source') ?? '') };
      if (s.get('Enabled') === false) d.enabled = false;
      return d;
    });
  }
  return c;
}

export function toRblxui(root: Inst, extra: Record<string, unknown> = {}, withLua = true): RblxuiFile {
  const { class: _cls, ...screenGui } = toComponent(root);
  const file: RblxuiFile = { schema: SCHEMA, instructions: INSTRUCTIONS, ...extra, screenGui: screenGui as Component };
  if (withLua) file.lua = generateLua(root);
  return file;
}

/** JSON laid out per component: a component's own fields on one line, children and scripts nested below. */
export function stringifyRblxui(f: RblxuiFile): string {
  const inline = (v: unknown): string =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? `{ ${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }`
      : JSON.stringify(v);
  const component = (c: Component, ind: string): string => {
    const { children, scripts, ...own } = c;
    const head = Object.entries(own).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    const list = (key: string, items: unknown[], fmt: (x: never, ind: string) => string) =>
      `${JSON.stringify(key)}: [\n${items.map((x) => `${ind}    ${fmt(x as never, `${ind}    `)}`).join(',\n')}\n${ind}  ]`;
    const tail: string[] = [];
    if (children?.length) tail.push(list('children', children, component));
    if (scripts?.length) tail.push(list('scripts', scripts, (x) => inline(x)));
    if (!tail.length) return `{ ${head.join(', ')} }`;
    return `{ ${head.join(', ')},\n${tail.map((t) => `${ind}  ${t}`).join(',\n')}\n${ind}}`;
  };
  const top = Object.entries(f).filter(([, x]) => x !== undefined)
    .map(([k, x]) => `  ${JSON.stringify(k)}: ${k === 'screenGui' ? component(x as Component, '  ') : JSON.stringify(x)}`);
  return `{\n${top.join(',\n')}\n}\n`;
}

/** Flat component list for MCP list_components and the palette. */
export function listComponents(root: Inst) {
  const out: { path: string; class: string; name: string; scripts: number }[] = [];
  const walk = (i: Inst, path: string) => {
    out.push({ path, class: i.className, name: i.name, scripts: i.children.filter((c) => isScript(c.className)).length });
    for (const c of i.children) if (!isScript(c.className)) walk(c, `${path}.${c.name}`);
  };
  walk(root, root.name);
  return out;
}
