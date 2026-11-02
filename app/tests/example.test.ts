import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRblxui, stringifyRblxui, toRblxui } from '../src/core/rblxui';
import { layoutScreenGui } from '../src/core/layout';
import { Runtime, type RuntimeHost } from '../src/runtime/runtime';
import type { Inst } from '../src/core/instance';

const path = fileURLToPath(new URL('../../examples/MainHUD.rblxui', import.meta.url));

describe('examples/MainHUD.rblxui', () => {
  it('parses cleanly and is canonical (run with UPDATE_EXAMPLE=1 to regenerate the lua field)', () => {
    const text = readFileSync(path, 'utf8');
    const { root, warnings, extra } = parseRblxui(text);
    expect(warnings).toEqual([]);
    const canonical = stringifyRblxui(toRblxui(root, extra));
    if (process.env.UPDATE_EXAMPLE) writeFileSync(path, canonical);
    else expect(text).toBe(canonical);
  });

  it('plays: menu, tabs, market, sliders, switches and view toggle all work', async () => {
    const { root } = parseRblxui(readFileSync(path, 'utf8'));
    const logs: string[] = [];
    let rt: Runtime;
    const layout = () => { for (const sg of rt.playerGui.children) layoutScreenGui(sg, { viewport: { w: 1920, h: 1080 }, topInset: 58, safe: { l: 0, t: 0, r: 0, b: 0 }, measureText: () => ({ w: 10, h: 10 }) }); };
    const host: RuntimeHost = {
      log: (k, m) => logs.push(`${k}: ${m}`), ensureLayout: layout, measureText: () => ({ w: 10, h: 10 }), requestStep: () => {},
      focusTextBox: () => {}, visualChanged: () => {}, viewport: () => ({ w: 1920, h: 1080 }), topInset: 58, touch: false,
    };
    rt = await Runtime.create([root], host);
    layout();
    rt.start();
    const hud = rt.playerGui.findFirstChild('MainHUD')!;
    const $ = (path: string) => path.split('.').reduce<Inst>((i, n) => i.findFirstChild(n)!, hud);
    let t = performance.now();
    const settle = () => { for (let i = 0; i < 40; i++) { t += 16; rt.step(t); } layout(); };
    const click = (i: Inst) => { rt.pointerDown(5, 5, [i]); rt.pointerUp(5, 5, [i]); settle(); };

    expect(logs.filter((l) => l.startsWith('error'))).toEqual([]);
    click($('PlayButton'));
    expect($('PlayMenu').get('Visible')).toBe(true);
    expect($('PlayButton').get('Visible')).toBe(false);
    expect($('PlayMenu.PopScale').get('Scale')).toBeCloseTo(1, 5);

    click($('PlayMenu.Tabs.Market'));
    expect($('PlayMenu.Pages.Market').get('Visible')).toBe(true);
    expect($('PlayMenu.Pages.Voyages').get('Visible')).toBe(false);
    expect($('PlayMenu.Header.Title').get('Text')).toBe('Harbor Market');

    click($('PlayMenu.Pages.Market.Grid.KrakenInkMap.Buy'));
    expect($('Purse.Amount').get('Text')).toBe('750');
    expect($('PlayMenu.Pages.Market.Grid.KrakenInkMap.Buy').get('Text')).toBe('Owned');
    click($('PlayMenu.Pages.Market.Grid.SeaGlassCompass.Buy'));
    click($('PlayMenu.Pages.Market.Grid.SeaGlassCompass.Buy'));
    expect($('Purse.Amount').get('Text')).toBe('400');

    click($('PlayMenu.Tabs.Settings'));
    const track = $('PlayMenu.Pages.Settings.MusicVolume.Track');
    layout();
    const abs = { x: 0, y: 0 };
    for (let p: Inst | null = track; p && p.className !== 'ScreenGui'; p = p.parent) { abs.x += p.box.x; }
    abs.x += hud.box.x;
    rt.pointerDown(abs.x + track.box.w * 0.25, 300, [track]);
    rt.pointerMove(abs.x + track.box.w * 0.9, 300, [track]);
    rt.pointerUp(abs.x + track.box.w * 0.9, 300, [track]);
    settle();
    expect($('PlayMenu.Pages.Settings.MusicVolume.Value').get('Text')).toBe('90%');

    click($('PlayMenu.Pages.Settings.CameraShake.Switch'));
    expect($('PlayMenu.Pages.Settings.CameraShake').attrs.get('On')).toBe(true);

    click($('ViewToggle'));
    expect($('ViewToggle.Label').get('Text')).toBe('1st Person');
    rt.key('KeyV', true); rt.key('KeyV', false); settle();
    expect($('ViewToggle.Label').get('Text')).toBe('3rd Person');

    click($('PlayMenu.Header.Close'));
    expect($('PlayMenu').get('Visible')).toBe(false);
    rt.key('KeyM', true); rt.key('KeyM', false); settle();
    expect($('PlayMenu').get('Visible')).toBe(true);
    click($('PlayMenu.Pages.Voyages.Marigold.Embark'));
    expect($('Toast').get('Text')).toBe('Setting sail for Wreck of the Marigold!');
    expect(logs.filter((l) => l.startsWith('error'))).toEqual([]);
  });
});
