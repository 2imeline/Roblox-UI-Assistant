// Connects the builder to the MCP server (mcp/server.mjs), which listens on localhost.
// The server forwards Claude's tool calls; replies go back on the same socket.
import { generateLua } from '../core/luagen';
import { listComponents } from '../core/rblxui';
import { store } from './store';

export const DEFAULT_PORT = 47811;

type Request = { id: string; method: string; params?: Record<string, unknown> };

function handle(req: Request): unknown {
  switch (req.method) {
    case 'preview_ui': {
      if (store.mode === 'play') store.set('mode', 'edit');
      const data = req.params?.rblxui_data;
      const warnings = store.replace(typeof data === 'string' ? data : (data as object));
      store.log('info', `Claude pushed "${store.root.name}" (${store.root.descendants().length} instances)`);
      return { ok: true, name: store.root.name, instances: store.root.descendants().length, warnings };
    }
    case 'get_layout': return store.file(req.params?.include_lua === true);
    case 'export_lua': return { lua: generateLua(store.root) };
    case 'list_components': return { screenGui: store.root.name, components: listComponents(store.root) };
  }
  throw new Error(`Unknown method ${req.method}`);
}

export function connectBridge() {
  const port = Number(new URLSearchParams(location.search).get('mcpPort')) || DEFAULT_PORT;
  let delay = 1000;
  const open = () => {
    store.set('mcp', 'connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(`ws://127.0.0.1:${port}`); } catch { setTimeout(open, delay); return; }
    ws.onopen = () => {
      delay = 1000;
      store.set('mcp', 'connected');
      ws.send(JSON.stringify({ type: 'hello', role: 'builder', app: 'roblox-ui-builder', version: 1 }));
    };
    ws.onmessage = (ev) => {
      let req: Request;
      try { req = JSON.parse(String(ev.data)); } catch { return; }
      if (!req || typeof req.id !== 'string' || typeof req.method !== 'string') return;
      try { ws.send(JSON.stringify({ id: req.id, result: handle(req) })); }
      catch (e) { ws.send(JSON.stringify({ id: req.id, error: e instanceof Error ? e.message : String(e) })); }
    };
    ws.onclose = () => {
      store.set('mcp', 'off');
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 5000);
    };
  };
  open();
}
