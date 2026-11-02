import { describe, expect, it } from 'vitest';
import { parseRblxui, toRblxui } from '../src/core/rblxui';
import { generateLua } from '../src/core/luagen';
import { layoutScreenGui } from '../src/core/layout';
import { Runtime, type RuntimeHost } from '../src/runtime/runtime';
import { instrument } from '../src/runtime/instrument';
import type { Inst } from '../src/core/instance';
import { udim2 } from '../src/core/values';

function host(extra: Partial<RuntimeHost> = {}) {
  const logs: { kind: string; msg: string; trace?: string }[] = [];
  let rt: Runtime | undefined;
  const h: RuntimeHost & { logs: typeof logs; bind(r: Runtime): void } = {
    logs,
    bind(r) { rt = r; },
    log: (kind, msg, trace) => logs.push({ kind, msg, trace }),
    ensureLayout: () => { for (const sg of rt?.playerGui.children ?? []) layoutScreenGui(sg, { viewport: { w: 1280, h: 720 }, topInset: 58, safe: { l: 0, t: 0, r: 0, b: 0 }, measureText: () => ({ w: 10, h: 10 }) }); },
    measureText: (t, size) => ({ w: t.length * size * 0.5, h: size }),
    requestStep: () => {},
    focusTextBox: () => {},
    visualChanged: () => {},
    viewport: () => ({ w: 1280, h: 720 }),
    topInset: 58,
    touch: false,
    ...extra,
  };
  return h;
}

const ui = (script: string, extraChildren: object[] = []) => parseRblxui({
  schema: 'rblxui/1.0',
  screenGui: {
    name: 'MainHUD',
    children: [
      { class: 'TextButton', name: 'Play', properties: { Size: 'UDim2.new(0, 200, 0, 50)', Text: '"PLAY"' } },
      { class: 'Frame', name: 'Menu', properties: { Visible: 'false', Position: 'UDim2.new(0, 0, 0, 0)' }, children: [{ class: 'TextLabel', name: 'Title', properties: { Text: '"Menu"' } }] },
      ...extraChildren,
    ],
    scripts: [{ name: 'Main', type: 'LocalScript', source: script }],
  },
}).root;

async function boot(script: string, extra: Partial<RuntimeHost> = {}, kids: object[] = []) {
  const h = host(extra);
  const rt = await Runtime.create([ui(script, kids)], h);
  h.bind(rt);
  rt.start();
  const gui = rt.playerGui.findFirstChild('MainHUD')!;
  const $ = (n: string) => gui.findFirstChild(n, true)!;
  const click = (i: Inst) => { rt.pointerDown(10, 70, [i]); rt.pointerUp(10, 70, [i]); };
  let t = performance.now();
  const advance = (ms: number) => { for (let i = 0; i < ms / 16; i++) { t += 16; rt.step(t); } };
  return { rt, h, $, click, advance, gui };
}

describe('runtime', () => {
  it('runs LocalScripts and handles clicks, hover and Roblox datatypes', async () => {
    const { $, click, h, rt } = await boot(`
      local hud = script.Parent
      local play, menu = hud:WaitForChild("Play"), hud.Menu
      assert(typeof(play) == "Instance" and play:IsA("GuiButton") and play.ClassName == "TextButton")
      assert(typeof(play.Size) == "UDim2" and play.Size.X.Offset == 200 and play.Size == UDim2.fromOffset(200, 50))
      assert(play.Size + UDim2.new(0, 1, 0, 0) == UDim2.new(0, 201, 0, 50))
      assert(menu.Title.Text == "Menu", "child lookup")
      local hovered = false
      play.MouseEnter:Connect(function() hovered = true end)
      play.MouseButton1Click:Connect(function()
        menu.Visible = not menu.Visible
        play.Text = if menu.Visible then "CLOSE" else "PLAY"
        print("toggled", menu.Visible, hovered, Enum.Font.GothamBold, Color3.fromRGB(255, 0, 0))
      end)
    `);
    expect(h.logs.filter((l) => l.kind === 'error')).toEqual([]);
    click($('Play'));
    expect($('Menu').get('Visible')).toBe(true);
    expect($('Play').get('Text')).toBe('CLOSE');
    expect(h.logs.find((l) => l.kind === 'out')?.msg).toBe('toggled true true Enum.Font.GothamBold 1, 0, 0');
    click($('Play'));
    expect($('Menu').get('Visible')).toBe(false);
    expect(rt.visualState($('Play'))).toBe('hover');
  });

  it('tweens, task.wait, property-changed signals and attributes', async () => {
    const { $, advance, h } = await boot(`
      local TweenService = game:GetService("TweenService")
      local menu = script.Parent.Menu
      local done = nil
      menu:GetPropertyChangedSignal("Visible"):Connect(function() menu.Title.Text = "visible:" .. tostring(menu.Visible) end)
      menu:SetAttribute("Coins", 25)
      local tw = TweenService:Create(menu, TweenInfo.new(0.2, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Position = UDim2.new(0.5, 0, 0, 100), BackgroundTransparency = 0.5 })
      tw.Completed:Connect(function(state) done = state end)
      tw:Play()
      task.delay(0.3, function() menu.Visible = true end)
      local elapsed = task.wait(0.1)
      assert(elapsed >= 0.09, "elapsed " .. elapsed)
      assert(menu:GetAttribute("Coins") == 25)
      task.wait(0.4)
      print(done, tw.PlaybackState)
    `);
    advance(600);
    expect(h.logs.filter((l) => l.kind === 'error')).toEqual([]);
    expect($('Menu').get('Position')).toEqual(udim2(0.5, 0, 0, 100));
    expect($('Menu').get('BackgroundTransparency')).toBe(0.5);
    expect($('Title').get('Text')).toBe('visible:true');
    expect(h.logs.find((l) => l.kind === 'out')?.msg).toBe('Enum.PlaybackState.Completed Enum.PlaybackState.Completed');
  });

  it('reports errors with the script path and line', async () => {
    const { h } = await boot(`local x = nil\nprint(x.y)`);
    const err = h.logs.find((l) => l.kind === 'error')!;
    expect(err.msg).toMatch(/MainHUD\.Main:2: attempt to index nil with 'y'/);
  });

  it('rejects wrong property types like Roblox', async () => {
    const { h } = await boot(`local ok, e = pcall(function() script.Parent.Play.Size = 5 end) print(e)\nlocal ok2, e2 = pcall(function() return script.Parent.Nope end) print(e2)`);
    expect(h.logs.map((l) => l.msg)).toEqual([
      expect.stringMatching(/Unable to assign property Size. UDim2 expected, got number/),
      expect.stringMatching(/Nope is not a valid member of ScreenGui "Players.Player.PlayerGui.MainHUD"/),
    ]);
  });

  it('stops runaway loops with a script timeout', async () => {
    const { h, $, click } = await boot(`script.Parent.Play.MouseButton1Click:Connect(function() while true do end end)\nscript.Parent.Menu.Visible = true`, { timeoutMs: 200 });
    expect($('Menu').get('Visible')).toBe(true);
    const t0 = performance.now();
    click($('Play'));
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(h.logs.find((l) => l.kind === 'error')?.msg).toMatch(/MainHUD\.Main:1: Script timeout: exhausted allowed execution time/);
  });

  it('stubs game objects outside the UI and logs remotes', async () => {
    const { h } = await boot(`
      local RS = game:GetService("ReplicatedStorage")
      local remote = RS:WaitForChild("Remotes"):WaitForChild("Buy")
      remote:FireServer("Sword", 2)
      remote.OnClientEvent:Connect(function() end)
      local player = game.Players.LocalPlayer
      local char = player.Character or player.CharacterAdded:Wait()
      local hum = char:WaitForChild("Humanoid")
      print(hum.Health, player.Name, workspace.CurrentCamera.ViewportSize)
      game:GetService("MarketplaceService"):PromptGamePassPurchase(player, 123)
      game:GetService("StarterGui"):SetCore("ResetButtonCallback", false)
    `);
    expect(h.logs.filter((l) => l.kind === 'error')).toEqual([]);
    expect(h.logs.some((l) => l.msg.includes('FireServer(Sword 2)'))).toBe(true);
    expect(h.logs.some((l) => l.msg === '100 Player 1280, 720')).toBe(true);
  });

  it('runs the generated command-bar Lua and rebuilds the same tree', async () => {
    const original = ui(`print("hi")`, [{ class: 'Frame', name: 'Box', properties: { BackgroundColor3: 'Color3.fromRGB(10, 20, 30)' }, attributes: { Tier: '"gold"' }, children: [{ class: 'UICorner', name: 'UICorner', properties: { CornerRadius: 'UDim.new(0, 12)' } }] }]);
    const lua = generateLua(original);
    const { rt, h } = await boot(lua);
    expect(h.logs.filter((l) => l.kind === 'error')).toEqual([]);
    const rebuilt = rt.game.findFirstChild('StarterGui')!.findFirstChild('MainHUD')!;
    const strip = (f: ReturnType<typeof toRblxui>) => JSON.parse(JSON.stringify(f.screenGui));
    // The generator pins a few defaults explicitly, so compare after a second generation.
    expect(generateLua(rebuilt)).toBe(generateLua(parseRblxui(toRblxui(rebuilt)).root));
    expect(strip(toRblxui(rebuilt)).children.length).toBe(strip(toRblxui(original)).children.length);
    expect(rebuilt.findFirstChild('Box')!.attrs.get('Tier')).toBe('gold');
    expect(String(rebuilt.findFirstChild('Main')!.get('Source'))).toBe(String(original.findFirstChild('Main')!.get('Source')));
  });
});

describe('instrument', () => {
  it('adds loop checks without touching strings or comments', () => {
    const src = 'local s = "do repeat" -- do\nfor i = 1, 3 do print(`{i} do`) end\nrepeat x = 1 until true\nlocal t = { do_ = 1 }';
    const out = instrument(src);
    expect(out).toContain('for i = 1, 3 do __rbxc(); print(`{i} do`) end');
    expect(out).toContain('repeat __rbxc(); x = 1');
    expect(out).toContain('"do repeat" -- do\n');
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });
});
