import { resolveObjectURL } from 'node:buffer';
import { gzipSync } from 'node:zlib';
import { beforeAll, expect, it, vi } from 'vitest';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const store = new Map<string, string>();
const calls: string[] = [];
let refuse = false;

beforeAll(() => {
  vi.stubGlobal('window', { dispatchEvent: () => true });
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(url);
    const m = /assetId\/(\d+)$/.exec(url);
    if (m) {
      if (refuse) return new Response('{"errors":["Forbidden"]}', { status: 403 });
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe('k');
      return Response.json({ location: `https://c1.rbxcdn.com/${m[1]}` });
    }
    const id = url.split('/').pop();
    if (id === '100') return new Response(PNG);
    if (id === '200') return new Response(gzipSync(PNG));
    if (id === '300') return new Response('<roblox><Item class="Decal"><url>http://www.roblox.com/asset/?id=100</url></Item></roblox>');
    if (url.includes('thumbnails')) return Response.json({ data: [{ targetId: 400, state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/thumb' }] });
    return new Response('', { status: 404 });
  });
});

// Like the renderer: ask again each time it says the image is ready, until it is no longer loading.
const load = (imageUrl: (c: string, f: () => void) => string | null | undefined, content: string) =>
  new Promise<string | null>((resolve) => {
    const ask = () => { const u = imageUrl(content, ask); if (u !== undefined) resolve(u); };
    ask();
  });

it('downloads full images with an API key, following decals and gzip, and falls back to thumbnails', async () => {
  const { imageUrl, setApiKey, setAssetWarningHandler } = await import('../src/render/assets');
  const warnings: string[] = [];
  setAssetWarningHandler((m) => warnings.push(m));
  setApiKey('k');
  for (const id of ['100', '200', '300']) {
    const url = await load(imageUrl, `rbxassetid://${id}`);
    expect(url).toMatch(/^blob:/);
    const bytes = new Uint8Array(await resolveObjectURL(url!)!.arrayBuffer());
    expect([...bytes]).toEqual([...PNG]);
  }
  refuse = true;
  expect(await load(imageUrl, 'rbxassetid://400')).toBe('https://tr.rbxcdn.com/thumb');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatch(/refused the API key/);
});
