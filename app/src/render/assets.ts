// Resolves Roblox image content ids to URLs the webview can load.
// rbxassetid:// ids go through Roblox's thumbnail API (via Tauri's HTTP client, which avoids CORS).
// shortcut: thumbnails are capped at 420x420, so 9-slice margins on larger source images are approximate; resolving originals needs authenticated assetdelivery.

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

async function httpFetch(url: string): Promise<Response> {
  if ('__TAURI_INTERNALS__' in window) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(url);
  }
  return fetch(url);
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
