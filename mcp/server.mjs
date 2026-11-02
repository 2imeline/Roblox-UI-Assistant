#!/usr/bin/env node
// MCP server (stdio) for the Roblox UI Builder.
// It listens on ws://127.0.0.1:<port>; the builder app connects to it and answers tool calls.
// If another instance already owns the port (a second Claude session), this one relays through it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = Number(process.env.RBLXUI_PORT) || 47811;
const TIMEOUT = 20000;
const VERSION = '0.1.0';
const log = (...a) => process.stderr.write(`[rblxui-mcp] ${a.join(' ')}\n`);

// Browsers always send Origin, so only the app itself (Tauri, or the Vite dev server) and Node peers get in.
export const ALLOWED_ORIGIN = /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

// ---------------- bridge ----------------
let builder = null; // WebSocket of the connected builder (server mode)
let upstream = null; // WebSocket to the primary instance (peer mode)
const pending = new Map(); // id -> { resolve, reject, timer }
const relayed = new Map(); // builder-side id -> { peer, id }
let seq = 0;

function settle(id, msg) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  if (msg.error) p.reject(new Error(msg.error));
  else p.resolve(msg.result);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({
      host: '127.0.0.1', port: PORT, maxPayload: 64 * 1024 * 1024,
      verifyClient: ({ origin }) => !origin || ALLOWED_ORIGIN.test(origin),
    });
    wss.once('listening', () => { log(`listening on ws://127.0.0.1:${PORT}`); resolve(wss); });
    wss.once('error', reject);
    wss.on('connection', (ws) => {
      let role = null;
      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(String(data)); } catch { return; }
        if (msg?.type === 'hello') {
          role = msg.role;
          if (role === 'builder') {
            if (builder && builder !== ws) builder.close(4000, 'replaced by a newer builder window');
            builder = ws;
            log('builder connected');
          }
          return;
        }
        if (role === 'builder' && typeof msg?.id === 'string') {
          const r = relayed.get(msg.id);
          if (r) { relayed.delete(msg.id); r.peer.send(JSON.stringify({ ...msg, id: r.id })); }
          else settle(msg.id, msg);
        } else if (role === 'peer' && typeof msg?.id === 'string' && typeof msg.method === 'string') {
          if (!builder || builder.readyState !== WebSocket.OPEN) {
            ws.send(JSON.stringify({ id: msg.id, error: 'NO_BUILDER' }));
            return;
          }
          const id = `r${++seq}`;
          relayed.set(id, { peer: ws, id: msg.id });
          builder.send(JSON.stringify({ id, method: msg.method, params: msg.params }));
        }
      });
      ws.on('close', () => {
        if (ws === builder) { builder = null; log('builder disconnected'); }
        for (const [id, r] of relayed) if (r.peer === ws) relayed.delete(id);
      });
    });
    wss.on('close', () => { builder = null; });
  });
}

function startPeer() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'peer' }));
      log(`relaying through the instance on port ${PORT}`);
      upstream = ws;
      resolve(ws);
    });
    ws.once('error', reject);
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (typeof msg?.id === 'string') settle(msg.id, msg);
    });
    ws.on('close', () => {
      if (upstream === ws) upstream = null;
      for (const [id, p] of pending) { clearTimeout(p.timer); pending.delete(id); p.reject(new Error('Lost connection to the primary MCP instance')); }
      setTimeout(connect, 500);
    });
  });
}

let connecting = null;
async function connect() {
  if (connecting) return connecting;
  connecting = (async () => {
    try { await startServer(); } catch (e) {
      if (e.code !== 'EADDRINUSE') { log(`cannot listen on ${PORT}: ${e.message}`); return; }
      try { await startPeer(); } catch (err) { log(`port ${PORT} is busy and not an rblxui-mcp instance: ${err.message}`); }
    }
  })();
  try { await connecting; } finally { connecting = null; }
}

function send(method, params) {
  return new Promise((resolve, reject) => {
    const target = upstream ?? builder;
    if (!target || target.readyState !== WebSocket.OPEN) return reject(new Error('NO_BUILDER'));
    const id = `c${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The builder did not answer in time')); }, TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    target.send(JSON.stringify({ id, method, params }));
  });
}

function builderPaths() {
  if (process.env.RBLXUI_BUILDER) return [process.env.RBLXUI_BUILDER];
  if (platform() === 'darwin') return ['/Applications/Roblox UI Builder.app', join(homedir(), 'Applications/Roblox UI Builder.app')];
  if (platform() === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local');
    return [join(local, 'Roblox UI Builder', 'roblox-ui-builder.exe'), join(local, 'Programs', 'Roblox UI Builder', 'roblox-ui-builder.exe'),
      join(process.env.ProgramFiles ?? 'C:/Program Files', 'Roblox UI Builder', 'roblox-ui-builder.exe')];
  }
  return ['/usr/bin/roblox-ui-builder', '/usr/local/bin/roblox-ui-builder'];
}

const startedAt = Date.now();
const GRACE = Number(process.env.RBLXUI_CONNECT_GRACE_MS ?? 6000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retries while the builder is (re)connecting; true once a request got through. */
async function retry(method, params, untilMs) {
  while (Date.now() < untilMs) {
    await sleep(400);
    try { return { ok: true, value: await send(method, params) }; } catch (e) { if (e.message !== 'NO_BUILDER') throw e; }
  }
  return { ok: false };
}

function launchApp() {
  const app = builderPaths().find((p) => existsSync(p));
  if (!app) return false;
  log(`starting ${app}`);
  const child = app.endsWith('.app') ? spawn('open', ['-a', app], { detached: true, stdio: 'ignore' }) : spawn(app, [], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => log(`could not start the builder: ${e.message}`));
  child.unref();
  return true;
}

async function call(method, params, launch = false) {
  try {
    return await send(method, params);
  } catch (e) {
    if (e.message !== 'NO_BUILDER') throw e;
  }
  // A running builder reconnects within ~5 s of this server starting; don't launch a second copy before then.
  let r = await retry(method, params, startedAt + GRACE);
  if (!r.ok && launch && launchApp()) r = await retry(method, params, Date.now() + 15000);
  if (r.ok) return r.value;
  throw new Error(
    'The Roblox UI Builder app is not connected. Ask the user to open it (it connects automatically), ' +
    'or set RBLXUI_BUILDER to its install path so this server can start it. Fallback: give the user the .rblxui file to open in the builder.');
}

// ---------------- MCP ----------------
const TOOLS = [
  {
    name: 'preview_ui',
    description: 'Open a .rblxui document in the Roblox UI Builder canvas so the user can see it, play it and drag things around. Pass the complete .rblxui JSON (schema, instructions, screenGui, lua). Replaces what is on the canvas; the user can undo.',
    inputSchema: {
      type: 'object',
      properties: { rblxui_data: { description: 'The full .rblxui document, as a JSON object or a JSON string.', anyOf: [{ type: 'object' }, { type: 'string' }] } },
      required: ['rblxui_data'],
    },
    run: async ({ rblxui_data }) => {
      let doc = rblxui_data;
      if (typeof doc === 'string') {
        try { doc = JSON.parse(doc); } catch (e) { throw new Error(`rblxui_data is not valid JSON: ${e.message}`); }
      }
      if (!doc || typeof doc !== 'object' || !doc.screenGui || typeof doc.screenGui !== 'object') throw new Error('rblxui_data must be a .rblxui document with a "screenGui" object');
      const r = await call('preview_ui', { rblxui_data: doc }, true);
      const warn = r.warnings?.length ? `\nWarnings from the builder:\n- ${r.warnings.join('\n- ')}` : '';
      return `Opened "${r.name}" in the builder (${r.instances} instances). The user can now play it (F5) and rearrange it; call get_layout to read their changes.${warn}`;
    },
  },
  {
    name: 'get_layout',
    description: 'Read the current canvas from the Roblox UI Builder as .rblxui JSON, including anything the user moved, resized, re-parented or edited. The flat `lua` field is omitted unless include_lua is true (use export_lua for it).',
    inputSchema: { type: 'object', properties: { include_lua: { type: 'boolean', description: 'Also include the generated command-bar Lua.' } } },
    run: async ({ include_lua }) => JSON.stringify(await call('get_layout', { include_lua: include_lua === true })),
  },
  {
    name: 'export_lua',
    description: 'Generate the flat Roblox Studio command-bar Lua for the current canvas (creates the ScreenGui, its properties and scripts under StarterGui).',
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await call('export_lua', {})).lua,
  },
  {
    name: 'list_components',
    description: 'List every instance on the builder canvas with its path and class, so you can refer to components by name.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const r = await call('list_components', {});
      return [`ScreenGui ${r.screenGui}`, ...r.components.map((c) => `${c.path}  (${c.class}${c.scripts ? `, ${c.scripts} script${c.scripts > 1 ? 's' : ''}` : ''})`)].join('\n');
    },
  },
];

const INSTRUCTIONS = 'Tools for the Roblox UI Builder desktop app. Build UI as a .rblxui file (see its `instructions` field), call preview_ui to show it on the canvas, and get_layout to read back what the user changed before regenerating.';

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'rblxui', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool ${params?.name}`);
      try {
        const text = await tool.run(params.arguments ?? {});
        return reply(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: e.message }], isError: true });
      }
    }
    default: return fail(id, -32601, `Method not found: ${method}`);
  }
}

connect();
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  handle(msg).catch((e) => log(e.stack ?? e));
});
rl.on('close', () => process.exit(0));
