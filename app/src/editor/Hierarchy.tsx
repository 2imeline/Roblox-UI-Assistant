import { useEffect, useState } from 'react';
import { isGuiObject, isScript } from '../core/classes';
import { type Inst, atPath } from '../core/instance';
import { reparent } from './ops';
import { store, useStore } from './store';

const ABBR: Record<string, string> = {
  ScreenGui: 'SG', Frame: 'Fr', TextLabel: 'Tx', TextButton: 'Bt', TextBox: 'In', ImageLabel: 'Im', ImageButton: 'IB', ScrollingFrame: 'Sc',
  CanvasGroup: 'CG', ViewportFrame: 'VF', UICorner: 'Co', UIStroke: 'St', UIGradient: 'Gr', UIPadding: 'Pd', UIListLayout: 'Li', UIGridLayout: 'Gd',
  UIAspectRatioConstraint: 'AR', UISizeConstraint: 'SC', UITextSizeConstraint: 'TS', UIScale: 'Sl', LocalScript: 'LS', Script: 'Sv', ModuleScript: 'MS',
};
export const abbr = (cls: string) => ABBR[cls] ?? cls.slice(0, 2);
export const kindOf = (cls: string) => (isScript(cls) ? 'script' : isGuiObject(cls) || cls === 'ScreenGui' ? 'gui' : 'mod');

const MIME = 'application/x-rbxui-tree';

export function Hierarchy() {
  const s = useStore();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['r']));
  // Reveal the selection (e.g. after clicking it on the canvas).
  useEffect(() => {
    const path = s.selection?.pathFrom(s.root);
    if (!path) return;
    const keys = path.slice(0, -1).map((_, i) => ['r', ...path.slice(0, i + 1)].join('/'));
    setExpanded((e) => (keys.every((k) => e.has(k)) ? e : new Set([...e, 'r', ...keys])));
  }, [s.selection, s.root]);
  const [drop, setDrop] = useState<{ key: string; zone: 'before' | 'after' | 'into' } | null>(null);
  const rows: { inst: Inst; depth: number; key: string }[] = [];
  const walk = (inst: Inst, depth: number, key: string) => {
    rows.push({ inst, depth, key });
    if (!expanded.has(key)) return;
    inst.children.forEach((c, i) => walk(c, depth + 1, `${key}/${i}`));
  };
  walk(s.root, 0, 'r');

  const toggle = (key: string) => setExpanded((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const zoneOf = (e: React.DragEvent, isRoot: boolean): 'before' | 'after' | 'into' => {
    if (isRoot) return 'into';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    return f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'into';
  };

  const onDrop = (e: React.DragEvent, target: Inst) => {
    e.preventDefault();
    setDrop(null);
    const raw = e.dataTransfer.getData(MIME);
    if (!raw || s.mode === 'play') return;
    const src = atPath(store.root, JSON.parse(raw) as number[]);
    if (!src || src === target) return;
    const zone = zoneOf(e, target === store.root);
    const ok = zone === 'into'
      ? reparent(src, target)
      : reparent(src, target.parent!, (() => {
        const sibs = target.parent!.children.filter((c) => c !== src);
        return sibs.indexOf(target) + (zone === 'after' ? 1 : 0);
      })());
    if (ok) { store.select(src); store.commit(); }
  };

  return (
    <div className="panel hierarchy">
      <div className="panel-head"><h2>Explorer</h2></div>
      <div className="panel-body tree" role="tree">
        {rows.map(({ inst, depth, key }) => {
          const hasKids = inst.children.length > 0;
          const isSel = s.selection === inst;
          const hidden = isGuiObject(inst.className) && inst.get('Visible') === false;
          return (
            <div
              key={key}
              role="treeitem"
              aria-selected={isSel}
              className={`node k-${kindOf(inst.className)}${isSel ? ' sel' : ''}${hidden ? ' hidden' : ''}${drop?.key === key ? ` drop-${drop.zone}` : ''}`}
              style={{ paddingLeft: 6 + depth * 14 }}
              draggable={inst !== s.root && s.mode === 'edit'}
              onDragStart={(e) => { e.dataTransfer.setData(MIME, JSON.stringify(inst.pathFrom(store.root))); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (!e.dataTransfer.types.includes(MIME)) return; e.preventDefault(); setDrop({ key, zone: zoneOf(e, inst === s.root) }); }}
              onDragLeave={() => setDrop((d) => (d?.key === key ? null : d))}
              onDrop={(e) => onDrop(e, inst)}
              onClick={() => store.select(inst === s.root ? null : inst)}
            >
              <span className={`twisty${hasKids ? '' : ' none'}`} onClick={(e) => { e.stopPropagation(); if (hasKids) toggle(key); }}>
                {hasKids ? (expanded.has(key) ? '▾' : '▸') : ''}
              </span>
              <span className={`badge c-${inst.className}`}>{abbr(inst.className)}</span>
              <span className="label">{inst.name}</span>
              {inst.className !== inst.name && <span className="cls">{inst.className}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
