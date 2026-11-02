import { useState } from 'react';
import { PALETTE_GUI, PALETTE_MODIFIERS, isGuiObject } from '../core/classes';
import { DRAG_MIME } from './Canvas';
import { abbr } from './Hierarchy';
import { createInstance } from './ops';
import { store, useStore } from './store';

export function Palette() {
  const s = useStore();
  const [filter, setFilter] = useState('');
  const disabled = s.mode === 'play';
  const insert = (cls: string) => {
    if (disabled) return;
    const sel = store.selection && !store.selection.destroyed ? store.selection : store.root;
    const parent = PALETTE_MODIFIERS.includes(cls) || isGuiObject(sel.className) ? sel : store.root;
    store.select(createInstance(cls, parent, PALETTE_MODIFIERS.includes(cls) ? undefined : { x: 24, y: 24 }));
    store.commit();
  };
  const components = s.root.descendants().filter((i) => isGuiObject(i.className) && i.name.toLowerCase().includes(filter.toLowerCase()));

  const tile = (cls: string) => (
    <button
      key={cls}
      className="tile"
      draggable={!disabled}
      disabled={disabled}
      title={`${cls}: click to add to the selection, or drag onto the canvas`}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'new', cls })); e.dataTransfer.effectAllowed = 'copy'; }}
      onClick={() => insert(cls)}
    >
      <span className={`badge c-${cls}`}>{abbr(cls)}</span>
      {cls.replace(/^UI/, '')}
    </button>
  );

  return (
    <div className="panel palette">
      <div className="panel-head"><h2>Components</h2></div>
      <div className="panel-body">
        <h3>New</h3>
        <div className="tiles">{PALETTE_GUI.map(tile)}</div>
        <h3>Modifiers</h3>
        <div className="tiles">{PALETTE_MODIFIERS.map(tile)}</div>
        <h3>In this file <span className="count">{components.length}</span></h3>
        <input className="filter" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="list">
          {components.map((i) => (
            <div
              key={i.id}
              className={`item${s.selection === i ? ' sel' : ''}`}
              draggable={!disabled}
              title="Drag onto the canvas to duplicate"
              onDragStart={(e) => { e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'dup', path: i.pathFrom(store.root) })); e.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => store.select(i)}
            >
              <span className={`badge c-${i.className}`}>{abbr(i.className)}</span>
              <span className="label">{i.name}</span>
              <span className="cls">{i.parent?.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
