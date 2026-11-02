import { reclaimBridge } from './bridge';
import { exportAs, openFile, saveFile } from './io';
import { DEVICES, store, useStore } from './store';

export function Toolbar() {
  const s = useStore();
  const play = s.mode === 'play';
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
