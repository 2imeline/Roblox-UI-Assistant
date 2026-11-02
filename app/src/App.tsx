import { useEffect } from 'react';
import { Canvas } from './editor/Canvas';
import { Console } from './editor/Console';
import { Hierarchy } from './editor/Hierarchy';
import { Inspector } from './editor/Inspector';
import { openFile, openText, saveFile, setWindowTitle } from './editor/io';
import { duplicateSelected, removeSelected } from './editor/ops';
import { Palette } from './editor/Palette';
import { Toolbar } from './editor/Toolbar';
import { store, useStore } from './editor/store';
import type { UDim2 } from './core/values';
import { udim2 } from './core/values';

function editingText(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function App() {
  const s = useStore();

  useEffect(() => { setWindowTitle(`${s.name}${s.dirty ? ' •' : ''} — Roblox UI Builder`); }, [s.name, s.dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'F5') { e.preventDefault(); store.set('mode', store.mode === 'play' ? 'edit' : 'play'); return; }
      if (mod && k === 's') { e.preventDefault(); store.commit(); saveFile(e.shiftKey); return; }
      if (mod && k === 'o') { e.preventDefault(); openFile(); return; }
      if (store.mode === 'play') { if (e.key === 'Escape' && !editingText(e.target)) store.set('mode', 'edit'); return; }
      if (editingText(e.target)) return;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
      if (e.key === 'Escape') { store.select(null); return; }
      const sel = store.selection;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (sel && arrows[e.key] && sel.get('Position')) {
        e.preventDefault();
        const [dx, dy] = arrows[e.key].map((v) => v * (e.shiftKey ? 10 : 1));
        const p = sel.get('Position') as UDim2;
        sel.set('Position', udim2(p.xs, p.xo + dx, p.ys, p.yo + dy));
        store.commit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drop a .rblxui file anywhere to open it.
  const onDrop = (e: React.DragEvent) => {
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    e.preventDefault();
    if (store.dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    f.text().then((t) => openText(t, null, f.name.replace(/\.(rblxui|json)$/i, '')));
  };

  return (
    <div className="app" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={onDrop}>
      <Toolbar />
      <aside className="left">
        <Hierarchy />
        <Palette />
      </aside>
      <main className="center">
        <Canvas />
        <Console />
      </main>
      <aside className="right">
        <Inspector />
      </aside>
    </div>
  );
}
