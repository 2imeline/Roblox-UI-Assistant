// Resolves Roblox image content ids to URLs the webview can load (via Tauri's HTTP client, which avoids CORS).
// With a Roblox Open Cloud API key, images are downloaded in full from the Asset Delivery API, private ones
// included. Without one (or when the key is refused), rbxassetid:// ids go through the public thumbnail API,
// which is capped at 420x420 and shows a placeholder for images that are not public.

type Listener = () => void;
const resolved = new Map<string, string | null>();
const pending = new Map<string, Listener[]>();
const natural = new Map<string, { w: number; h: number }>();
const loading = new Map<string, Listener[]>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const STORE = 'rbxui.assets.v1';
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, string>;
  for (const [k, v] of Object.entries(saved)) resolved.set(k, v);
} catch { /* storage unavailable */ }
function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries([...resolved].filter(([, v]) => v).slice(-2000))));
  } catch { /* storage unavailable */ }
}

export function assetId(content: string): string | null {
  const m = /^rbxassetid:\/\/(\d+)/i.exec(content) ?? /roblox\.com\/asset\/?\?id=(\d+)/i.exec(content) ?? /^(\d+)$/.exec(content);
  return m ? m[1] : null;
}

async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  if ('__TAURI_INTERNALS__' in window) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(url, init);
  }
  return fetch(url, init);
}

// ---------- Open Cloud API key (full-size, private images) ----------

const KEY = 'rbxui.apikey';
/** Reported once per problem, e.g. to the Output panel. */
export let onAssetWarning: (msg: string) => void = () => {};
export function setAssetWarningHandler(fn: (msg: string) => void) { onAssetWarning = fn; }

export function apiKey(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}
export function setApiKey(key: string) {
  try { if (key) localStorage.setItem(KEY, key); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  for (const url of direct.values()) if (url) URL.revokeObjectURL(url);
  direct.clear();
  warned.clear();
  window.dispatchEvent(new Event('rbx-assets-reset'));
}

const direct = new Map<string, string | null>(); // id -> blob URL, or null to use the thumbnail
const directWaiting = new Map<string, Listener[]>();
const warned = new Set<string>();
const jobs: string[] = [];
let active = 0;

class KeyRefused extends Error {}

const MAGIC: [number[], string][] = [[[0x89, 0x50], 'image/png'], [[0xff, 0xd8], 'image/jpeg'], [[0x47, 0x49], 'image/gif'], [[0x52, 0x49], 'image/webp']];

async function download(id: string, key: string, depth = 0): Promise<string | null> {
  const r = await httpFetch(`https://apis.roblox.com/asset-delivery-api/v1/assetId/${id}`, { headers: { 'x-api-key': key } });
  if (r.status === 401 || r.status === 403) throw new KeyRefused(`${r.status} ${(await r.text()).slice(0, 200)}`);
  if (!r.ok) return null;
  const { location } = (await r.json()) as { location?: string };
  if (!location) return null;
  const f = await httpFetch(location);
  if (!f.ok) return null;
  let bytes = new Uint8Array(await f.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  // A Decal id downloads as a small XML model that names its Image; follow it.
  if (bytes[0] === 0x3c && depth < 2) {
    const m = /asset\/?\?id=(\d+)|rbxassetid:\/\/(\d+)/i.exec(new TextDecoder().decode(bytes));
    return m ? download(m[1] ?? m[2], key, depth + 1) : null;
  }
  const type = MAGIC.find(([sig]) => sig.every((b, i) => bytes[i] === b))?.[1];
  return type ? URL.createObjectURL(new Blob([bytes], { type })) : null;
}

function pump() {
  while (active < 6 && jobs.length) {
    const id = jobs.shift()!;
    const key = apiKey();
    active++;
    download(id, key)
      .catch((e) => {
        const msg = e instanceof KeyRefused
          ? `Roblox refused the API key (${e.message}). Check that it has the legacy-asset:manage permission and allows your IP address; images fall back to public thumbnails.`
          : `Could not download Roblox images (${e instanceof Error ? e.message : String(e)}); using public thumbnails.`;
        if (!warned.has(msg)) { warned.add(msg); onAssetWarning(msg); }
        return null;
      })
      .then((url) => {
        if (key !== apiKey()) return; // the key changed meanwhile
        direct.set(id, url);
        for (const fn of directWaiting.get(id) ?? []) fn();
        directWaiting.delete(id);
      })
      .finally(() => { active--; pump(); });
  }
}

async function flush() {
  timer = null;
  const ids = [...new Set(queue)].slice(0, 100);
  queue = queue.filter((id) => !ids.includes(id));
  if (queue.length) timer = setTimeout(flush, 50);
  let data: { targetId: number; state: string; imageUrl?: string }[] = [];
  try {
    const r = await httpFetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids.join(',')}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`);
    data = ((await r.json()) as { data?: typeof data }).data ?? [];
  } catch { /* offline or blocked: images stay unresolved */ }
  for (const id of ids) {
    const d = data.find((x) => String(x.targetId) === id);
    if (d?.state === 'Pending') { setTimeout(() => request(id), 1500); continue; }
    resolved.set(id, d?.state === 'Completed' && d.imageUrl ? d.imageUrl : null);
    for (const fn of pending.get(id) ?? []) fn();
    pending.delete(id);
  }
  persist();
}

function request(id: string) {
  queue.push(id);
  timer ??= setTimeout(flush, 30);
}

/** URL for an Image property, `null` if none/unresolvable, `undefined` while loading (onReady fires later). */
export function imageUrl(content: string, onReady: Listener): string | null | undefined {
  if (!content) return null;
  if (/^(https?:|data:|blob:)/i.test(content)) return content;
  const id = assetId(content);
  if (!id) return null;
  if (apiKey()) {
    const d = direct.get(id);
    if (d) return d;
    if (d === undefined) {
      const list = directWaiting.get(id);
      if (list) list.push(onReady);
      else { directWaiting.set(id, [onReady]); jobs.push(id); pump(); }
      return undefined;
    }
    // null: the download failed, fall through to the thumbnail
  }
  if (resolved.has(id)) return resolved.get(id)!;
  const list = pending.get(id);
  if (list) list.push(onReady);
  else { pending.set(id, [onReady]); request(id); }
  return undefined;
}

/** Natural pixel size of a loaded image (for 9-slice and ImageRect), `undefined` until known. */
export function naturalSize(url: string, onReady: Listener): { w: number; h: number } | undefined {
  const n = natural.get(url);
  if (n) return n;
  const waiting = loading.get(url);
  if (waiting) { waiting.push(onReady); return undefined; }
  loading.set(url, [onReady]);
  const img = new Image();
  img.onload = () => {
    natural.set(url, { w: img.naturalWidth, h: img.naturalHeight });
    for (const fn of loading.get(url) ?? []) fn();
    loading.delete(url);
  };
  img.onerror = () => loading.delete(url);
  img.src = url;
  return undefined;
}
