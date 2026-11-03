import { reclaimBridge } from './bridge';
import { useState } from 'react';
import { apiKey, setApiKey } from '../render/assets';
import { checkForUpdates, exportAs, isTauri, openFile, saveFile } from './io';
import { DEVICES, store, useStore } from './store';

/** Roblox Open Cloud API key, so the canvas can load private images at full size. */
function ImagesKey() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const has = !!apiKey();
  const save = (k: string) => { setApiKey(k); setOpen(false); };
  return (
    <span className="keybox">
      <button onClick={() => { setDraft(apiKey()); setOpen(!open); }} title="Roblox API key for loading your images">
        {has ? 'Image key ✓' : 'Image key'}
      </button>
      {open && (
        <div className="popover">
          <p>
            Without a key, only public images show. To load your own (and private) images at full size, create an API
            key at <b>create.roblox.com › Open Cloud › API Keys</b> with the <code>legacy-asset:manage</code> permission
            and accepted IP <code>0.0.0.0/0</code>, then paste it here. It is stored only on this computer.
          </p>
          <input type="password" placeholder="Paste API key" value={draft} autoFocus spellCheck={false}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(draft.trim()); if (e.key === 'Escape') setOpen(false); }} />
          <div className="row">
            <button onClick={() => save(draft.trim())} disabled={!draft.trim()}>Save</button>
            {has && <button onClick={() => { setDraft(''); save(''); }}>Remove key</button>}
            <span className="spacer" />
            <button onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </span>
  );
}

export function Toolbar() {
  const s = useStore();
  const play = s.mode === 'play';
  const [updating, setUpdating] = useState('');
  return (
    <header className="toolbar">
      <span className="brand">Roblox UI Builder</span>
      <div className="group">
        <button onClick={() => openFile()} title="Open (Ctrl+O)">Open</button>
        <button onClick={() => { store.commit(); saveFile(); }} title="Save (Ctrl+S)">Save</button>
        <button onClick={() => { store.commit(); saveFile(true); }} title="Save as (Ctrl+Shift+S)">Save as</button>
        <button onClick={() => exportAs('lua')} title="Command-bar script for Roblox Studio">Export .lua</button>
        <button onClick={() => exportAs('rbxmx')} title="Model file: drag into Roblox Studio">Export .rbxmx</button>
      </div>
      <div className="group">
        <button onClick={() => store.undo()} disabled={!s.canUndo || play} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={() => store.redo()} disabled={!s.canRedo || play} title="Redo (Ctrl+Y)">Redo</button>
      </div>
      <button className={`play${play ? ' on' : ''}`} onClick={() => store.set('mode', play ? 'edit' : 'play')} title="Run the UI's scripts (F5)">
        {play ? '■ Stop' : '▶ Play'}
      </button>
      <div className="group">
        <select value={s.device.id} onChange={(e) => store.set('device', DEVICES.find((d) => d.id === e.target.value)!)} title="Device preview">
          {DEVICES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <select value={String(s.zoom)} onChange={(e) => store.set('zoom', e.target.value === 'fit' ? 'fit' : Number(e.target.value))} title="Zoom">
          <option value="fit">Fit</option>
          {[0.25, 0.5, 0.75, 1, 1.5, 2].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
        </select>
        <select value={s.backdrop} onChange={(e) => store.set('backdrop', e.target.value)} title="Backdrop behind the UI">
          <option value="sky">Sky</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="checker">Checker</option>
        </select>
        <label className="check"><input type="checkbox" checked={s.showTopbar} onChange={(e) => store.set('showTopbar', e.target.checked)} />Topbar</label>
      </div>
      <span className="spacer" />
      {isTauri && <ImagesKey />}
      {isTauri && (
        <button onClick={() => checkForUpdates(setUpdating)} disabled={!!updating} title="Download and install the newest version">
          {updating || 'Check for updates'}
        </button>
      )}
      <span className="doc">{s.name}{s.dirty ? ' •' : ''}</span>
      {s.mcp === 'replaced' ? (
        <button className="mcp" onClick={reclaimBridge} title="Another builder window is connected to Claude. Click to connect this one instead.">
          Claude: other window
        </button>
      ) : (
        <span className={`mcp ${s.mcp}`} title={s.mcp === 'connected' ? 'Connected to Claude (MCP server)' : 'Waiting for the MCP server (see README)'}>
          {s.mcp === 'connected' ? 'Claude connected' : 'Claude offline'}
        </span>
      )}
    </header>
  );
}
