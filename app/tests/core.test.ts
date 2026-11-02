import { describe, expect, it } from 'vitest';
import { parseLiteral, toLiteral } from '../src/core/literal';
import { parseRblxui, toRblxui, stringifyRblxui } from '../src/core/rblxui';
import { generateLua, longString } from '../src/core/luagen';
import { generateRbxmx, encodeAttributes } from '../src/core/rbxmx';
import { rgb, udim2 } from '../src/core/values';

describe('lua literals', () => {
  const cases: [string, string][] = [
    ['UDim2.new(0, 200, 0, 50)', 'UDim2.new(0, 200, 0, 50)'],
    ['UDim2.new(0.5, -100, 0.8, 0)', 'UDim2.new(0.5, -100, 0.8, 0)'],
    ['UDim2.fromScale(0.5, 0.5)', 'UDim2.new(0.5, 0, 0.5, 0)'],
    ['UDim2.fromOffset(10, 20)', 'UDim2.new(0, 10, 0, 20)'],
    ['UDim2.fromScale(1, 0) + UDim2.fromOffset(-20, 40)', 'UDim2.new(1, -20, 0, 40)'],
    ['Color3.fromRGB(30, 30, 40)', 'Color3.fromRGB(30, 30, 40)'],
    ['Color3.new(1, 0.5, 0)', 'Color3.new(1, 0.5, 0)'],
    ['Color3.fromHex("#ff8800")', 'Color3.fromRGB(255, 136, 0)'],
    ['Enum.Font.GothamBold', 'Enum.Font.GothamBold'],
    ['"Play"', '"Play"'],
    ["'it\\'s \\\"q\\\"\\n'", '"it\'s \\"q\\"\\n"'],
    ['-0.25', '-0.25'],
    ['1/3', '0.333333'],
    ['true', 'true'],
    ['nil', 'nil'],
    ['Vector2.new(0.5, 0.5)', 'Vector2.new(0.5, 0.5)'],
    ['UDim.new(0, 8)', 'UDim.new(0, 8)'],
    ['Rect.new(10, 10, 20, 20)', 'Rect.new(10, 10, 20, 20)'],
    ['NumberRange.new(1, 2)', 'NumberRange.new(1, 2)'],
    ['ColorSequence.new(Color3.fromRGB(255, 0, 0), Color3.fromRGB(0, 0, 255))', 'ColorSequence.new(Color3.fromRGB(255, 0, 0), Color3.fromRGB(0, 0, 255))'],
    ['ColorSequence.new({ColorSequenceKeypoint.new(0, Color3.new(1,1,1)), ColorSequenceKeypoint.new(0.5, Color3.new(0,0,0)), ColorSequenceKeypoint.new(1, Color3.new(1,1,1))})',
      'ColorSequence.new({ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 255, 255)), ColorSequenceKeypoint.new(0.5, Color3.fromRGB(0, 0, 0)), ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 255, 255))})'],
    ['NumberSequence.new(0, 1)', 'NumberSequence.new(0, 1)'],
    ['Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Bold)', 'Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Bold, Enum.FontStyle.Normal)'],
    ['Font.fromEnum(Enum.Font.GothamBlack)', 'Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal)'],
    ['Vector2.new(math.huge, math.huge)', 'Vector2.new(math.huge, math.huge)'],
    ['"héllo ✓"', '"héllo ✓"'],
    ['"\\226\\156\\147"', '"✓"'],
  ];
  for (const [src, out] of cases) it(src, () => expect(toLiteral(parseLiteral(src))).toBe(out));

  it('round-trips through its own output', () => {
    for (const [, out] of cases) expect(toLiteral(parseLiteral(out))).toBe(out);
  });

  for (const bad of ['game:Destroy()', 'print("x")', 'UDim2.new(0, 1', 'Color3.fromRGB(1,2,3) -- hi', 'os.exit()', '{1, 2}', '"unterminated'])
    it(`rejects ${bad}`, () => expect(() => parseLiteral(bad)).toThrow());

  it('keeps offsets integral like Roblox', () => expect(udim2(0, 10.6, 0, -3.2)).toEqual(udim2(0, 11, 0, -3)));
});

const sample = {
  schema: 'rblxui/1.0',
  instructions: 'x',
  screenGui: {
    name: 'MainHUD',
    properties: { ResetOnSpawn: 'false', IgnoreGuiInset: true },
    children: [
      {
        class: 'TextButton', name: 'PlayButton',
        properties: { Size: 'UDim2.new(0, 200, 0, 50)', BackgroundColor3: 'Color3.fromRGB(30, 30, 40)', Text: '"PLAY ]]"', Font: 'Enum.Font.GothamBold', TextSize: 24 },
        attributes: { Price: '25', Label: '"Gold"' },
        children: [{ class: 'UICorner', name: 'UICorner', properties: { CornerRadius: 'UDim.new(0, 12)' } }],
        scripts: [{ name: 'Handler', type: 'LocalScript', source: 'local b = script.Parent\nlocal s = [[x]]\nprint(s)\n' }],
      },
      { class: 'TextLabel', name: 'Title', properties: { Text: 'Plain text, not a literal' } },
    ],
  },
};

describe('.rblxui', () => {
  it('parses, normalizes Font to FontFace and round-trips', () => {
    const { root, warnings } = parseRblxui(sample);
    expect(root.className).toBe('ScreenGui');
    const btn = root.findFirstChild('PlayButton')!;
    expect(btn.get('Size')).toEqual(udim2(0, 200, 0, 50));
    expect(btn.get('BackgroundColor3')).toEqual(rgb(30, 30, 40));
    expect(btn.props.has('Font')).toBe(false);
    expect((btn.get('FontFace') as { weight: number }).weight).toBe(700);
    expect(root.findFirstChild('Title')!.get('Text')).toBe('Plain text, not a literal');
    expect(warnings.some((w) => w.includes('plain text'))).toBe(true);
    const file = toRblxui(root);
    const again = parseRblxui(stringifyRblxui(file));
    expect(toRblxui(again.root)).toEqual(file);
    const kids = file.screenGui.children ?? [];
    expect(kids[0]?.scripts?.[0]?.source).toBe(sample.screenGui.children[0].scripts?.[0]?.source);
  });

  it('rejects garbage', () => {
    expect(() => parseRblxui('nope')).toThrow(/JSON/);
    expect(() => parseRblxui({ schema: 'rblxui/1.0' })).toThrow(/screenGui/);
  });

  it('generates Lua that preserves script source exactly', () => {
    const { root } = parseRblxui(sample);
    const lua = generateLua(root);
    expect(lua).toContain('make(2, "TextButton", 1, { Name = "PlayButton"');
    expect(lua).toContain('Size = UDim2.new(0, 200, 0, 50)');
    expect(lua).toContain('Text = "PLAY ]]"');
    expect(lua).toContain(':SetAttribute("Price", 25)');
    expect(lua).toContain('BorderSizePixel = 1'); // pinned default written explicitly
    expect(longString('a]=]b')).toBe('[==[\na]=]b]==]');
  });

  it('keeps names and control characters from becoming code', () => {
    const { root } = parseRblxui({ schema: 'rblxui/1.0', screenGui: { name: 'HUD\nprint("pwned")\n--' } });
    const lines = generateLua(root).split('\n');
    expect(lines[0]).toMatch(/^-- HUD print\("pwned"\) -- /);
    expect(lines).not.toContain('print("pwned")');
    expect(parseLiteral(toLiteral('\x015'))).toBe('\x015');
  });

  it('round-trips scripts that have children and attributes', () => {
    const { root } = parseRblxui({ schema: 'rblxui/1.0', screenGui: { name: 'G', children: [
      { class: 'LocalScript', name: 'Main', properties: { Source: '"return 1"' }, attributes: { Speed: '5' }, children: [
        { class: 'ModuleScript', name: 'Config', properties: { Source: '"return {}"' } }] }] } });
    const again = parseRblxui(toRblxui(root)).root;
    const main = again.findFirstChild('Main')!;
    expect(main.className).toBe('LocalScript');
    expect(main.attrs.get('Speed')).toBe(5);
    expect(main.findFirstChild('Config')?.className).toBe('ModuleScript');
    expect(main.get('Source')).toBe('return 1');
  });

  it('generates well-formed rbxmx', () => {
    const { root } = parseRblxui(sample);
    const xml = generateRbxmx(root);
    expect(xml).toContain('<Item class="ScreenGui"');
    expect(xml).toContain('<UDim2 name="Size"><XS>0</XS><XO>200</XO><YS>0</YS><YO>50</YO></UDim2>');
    expect(xml).toContain('<Font name="FontFace"><Family><url>rbxasset://fonts/families/GothamSSm.json</url></Family><Weight>700</Weight><Style>Normal</Style></Font>');
    expect(xml).toContain('<token name="ZIndexBehavior">1</token>');
    expect(xml).toContain('<ProtectedString name="Source"><![CDATA[local b');
    expect((xml.match(/<Item /g) ?? []).length).toBe((xml.match(/<\/Item>/g) ?? []).length);
    const attrs = encodeAttributes(root.findFirstChild('PlayButton')!.attrs)!;
    expect([...attrs.slice(0, 4)]).toEqual([2, 0, 0, 0]);
  });
});

describe('docs', () => {
  it('SPEC.md quotes the current instructions text', async () => {
    const { readFileSync } = await import('node:fs');
    const { INSTRUCTIONS } = await import('../src/core/rblxui');
    const spec = readFileSync(new URL('../../format/SPEC.md', import.meta.url), 'utf8');
    for (const line of INSTRUCTIONS.split('\n')) expect(spec).toContain(`> ${line}`);
  });
});
