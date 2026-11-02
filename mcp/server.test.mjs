import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';

const PORT = 47000 + Math.floor(Math.random() * 900);
const env = { ...process.env, RBLXUI_PORT: String(PORT), RBLXUI_BUILDER: '/nonexistent/builder', RBLXUI_CONNECT_GRACE_MS: '300' };

function startServer() {
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve) => {
    const n = ++id;
    waiting.set(n, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  const ready = (needle) => new Promise((resolve) => { const t = setInterval(() => { if (stderr.includes(needle)) { clearInterval(t); resolve(); } }, 20); });
  return { child, rpc, ready, stderr: () => stderr };
}

function fakeBuilder(origin = 'tauri://localhost') {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin });
  const seen = [];
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'builder' })));
  ws.on('message', (d) => {
    const req = JSON.parse(String(d));
    seen.push(req);
    const results = {
      preview_ui: { ok: true, name: req.params?.rblxui_data?.screenGui?.name, instances: 3, warnings: ['x: unknown class Foo'] },
      get_layout: { schema: 'rblxui/1.0', screenGui: { name: 'MainHUD' } },
      export_lua: { lua: '-- lua' },
      list_components: { screenGui: 'MainHUD', components: [{ path: 'MainHUD.Play', class: 'TextButton', name: 'Play', scripts: 1 }] },
    };
    ws.send(JSON.stringify({ id: req.id, result: results[req.method] }));
  });
  return { ws, seen };
}

test('MCP protocol, tools, origin check and peer relay', async (t) => {
  const a = startServer();
  t.after(() => a.child.kill());
  await a.ready('listening');

  const init = await a.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'rblxui');
  const list = await a.rpc('tools/list', {});
  assert.deepEqual(list.result.tools.map((x) => x.name), ['preview_ui', 'get_layout', 'export_lua', 'list_components']);

  const offline = await a.rpc('tools/call', { name: 'export_lua', arguments: {} });
  assert.equal(offline.result.isError, true);
  assert.match(offline.result.content[0].text, /not connected/);

  const bad = await a.rpc('tools/call', { name: 'preview_ui', arguments: { rblxui_data: '{nope' } });
  assert.equal(bad.result.isError, true);

  // A web page cannot pose as the builder.
  const evil = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'https://evil.example' });
  const [err] = await once(evil, 'error');
  assert.match(String(err.message), /401/);

  const b = fakeBuilder();
  await once(b.ws, 'open');
  await new Promise((r) => setTimeout(r, 50));
  const preview = await a.rpc('tools/call', { name: 'preview_ui', arguments: { rblxui_data: { schema: 'rblxui/1.0', screenGui: { name: 'MainHUD' } } } });
  assert.equal(preview.result.isError, undefined);
  assert.match(preview.result.content[0].text, /Opened "MainHUD" in the builder \(3 instances\)/);
  assert.match(preview.result.content[0].text, /unknown class Foo/);
  const layout = await a.rpc('tools/call', { name: 'get_layout', arguments: {} });
  assert.equal(JSON.parse(layout.result.content[0].text).screenGui.name, 'MainHUD');
  assert.equal(b.seen.find((x) => x.method === 'get_layout').params.include_lua, false);
  const lua = await a.rpc('tools/call', { name: 'export_lua', arguments: {} });
  assert.equal(lua.result.content[0].text, '-- lua');

  // Second instance (another Claude session) relays through the first.
  const c = startServer();
  t.after(() => c.child.kill());
  await c.ready('relaying');
  await c.rpc('initialize', { protocolVersion: '2025-03-26' });
  const comps = await c.rpc('tools/call', { name: 'list_components', arguments: {} });
  assert.equal(comps.result.content[0].text, 'ScreenGui MainHUD\nMainHUD.Play  (TextButton, 1 script)');

  const unknown = await a.rpc('nope/method', {});
  assert.equal(unknown.error.code, -32601);
  b.ws.close();
});
