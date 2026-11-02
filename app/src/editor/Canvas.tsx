import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isGuiObject, PALETTE_MODIFIERS } from '../core/classes';
import type { Inst } from '../core/instance';
import type { UDim2 } from '../core/values';
import { Engine } from './engine';
import { type Handle, createInstance, duplicate, layoutOf, laidOutSiblings, movedPosition, reorder, resized } from './ops';
import { TOPBAR, store, useStore } from './store';

type Drag =
  | { kind: 'move'; inst: Inst; x0: number; y0: number; p0: UDim2; moved: boolean; layout: boolean; index?: number }
  | { kind: 'resize'; inst: Inst; handle: Handle; x0: number; y0: number; s0: UDim2; p0: UDim2; w0: number; h0: number };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Figma-style picking: a click selects at the current selection's level (or the top-level component),
 *  `drill` goes one level deeper, `deep` takes the innermost object under the pointer. */
export function pick(hits: Inst[], selection: Inst | null, mode: 'click' | 'drill' | 'deep'): Inst | null {
  const top = hits[0];
  if (!top) return null;
  if (mode === 'deep') return top;
  const chain: Inst[] = [];
  for (let i: Inst | null = top; i && i.className !== 'ScreenGui'; i = i.parent) chain.push(i);
  if (mode === 'drill' && selection && chain.includes(selection)) {
    return chain[chain.indexOf(selection) - 1] ?? selection;
  }
  const ctx = selection?.parent;
  if (ctx && (top === ctx || top.isDescendantOf(ctx))) {
    const at = chain.find((i) => i.parent === ctx);
    if (at) return at;
  }
  return chain[chain.length - 1];
}
export const DRAG_MIME = 'application/x-rbxui';

export function Canvas() {
  const s = useStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const drag = useRef<Drag | null>(null);
  const [avail, setAvail] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<Inst | null>(null);
  const [insertLine, setInsertLine] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dev = s.device;
  const zoom = s.zoom === 'fit' ? Math.max(0.05, Math.min((avail.w - 40) / dev.w, (avail.h - 40) / dev.h)) : s.zoom;

  useLayoutEffect(() => {
    const el = hostRef.current!;
    const ro = new ResizeObserver(() => setAvail({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    engine.current = new Engine(surfaceRef.current!, store.device);
    return () => { ro.disconnect(); engine.current?.dispose(); engine.current = null; };
  }, []);

  useEffect(() => { engine.current?.setDevice(dev); }, [dev]);
  useEffect(() => { engine.current?.request(0); }, [s.version]);

  // Play / stop
  useEffect(() => {
    const e = engine.current!;
    if (s.mode === 'play') {
      store.log('info', `▶ Playing ${store.root.name} on ${dev.label}`);
      e.play(store.root).catch((err) => { store.log('error', `Could not start the Luau runtime: ${err}`); store.set('mode', 'edit'); });
    } else e.edit();
    setHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.mode]);

  // Keyboard goes to the game while playing.
  useEffect(() => {
    if (s.mode !== 'play') return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest?.('.panel') || ev.key === 'F5') return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(ev.code)) ev.preventDefault();
      engine.current?.runtime?.key(ev.code, ev.type === 'keydown');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
  }, [s.mode]);

  const toDevice = (e: { clientX: number; clientY: number }) => {
    const r = screenRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const hits = (e: { clientX: number; clientY: number }) => engine.current?.renderer.hitTest(e.clientX, e.clientY) ?? [];

  // ---------- pointer handling ----------
  const onPointerDown = (e: React.PointerEvent) => {
    const rt = engine.current?.runtime;
    if (s.mode === 'play') {
      if (!rt) return;
      const p = toDevice(e);
      rt.pointerDown(p.x, p.y, hits(e), e.button, e.pointerType === 'touch');
      return;
    }
    if (e.button !== 0) return;
    const p = toDevice(e);
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    const sel = store.selection;
    if (handle && sel && isGuiObject(sel.className)) {
      drag.current = { kind: 'resize', inst: sel, handle, x0: p.x, y0: p.y, s0: sel.get('Size') as UDim2, p0: sel.get('Position') as UDim2, w0: sel.box.w, h0: sel.box.h };
    } else {
      const target = pick(hits(e), store.selection, e.altKey || e.ctrlKey || e.metaKey ? 'deep' : e.detail >= 2 ? 'drill' : 'click');
      store.select(target);
      if (target) drag.current = { kind: 'move', inst: target, x0: p.x, y0: p.y, p0: target.get('Position') as UDim2, moved: false, layout: !!layoutOf(target.parent) };
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toDevice(e);
    if (s.mode === 'play') {
      engine.current?.runtime?.pointerMove(p.x, p.y, hits(e), e.pointerType === 'touch');
      return;
    }
    const d = drag.current;
    if (!d) {
      const top = pick(hits(e), store.selection, e.altKey || e.ctrlKey || e.metaKey ? 'deep' : 'click');
      if (top !== hover) setHover(top);
      return;
    }
    const dx = p.x - d.x0, dy = p.y - d.y0;
    if (d.kind === 'resize') {
      const r = resized(d.inst, d.handle, d.s0, d.p0, d.w0, d.h0, dx, dy);
      d.inst.set('Size', r.size);
      d.inst.set('Position', r.pos);
      return;
    }
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    if (d.layout) {
      // Inside a UIListLayout/UIGridLayout, dragging reorders instead of moving.
      const sibs = laidOutSiblings(d.inst.parent!).filter((c) => c !== d.inst);
      const r = engine.current!.renderer;
      let index = sibs.length;
      for (let i = 0; i < sibs.length; i++) {
        const b = r.rectOf(sibs[i]);
        if (p.y < b.y + b.h / 2 && (p.x < b.x + b.w || p.y < b.y)) { index = i; break; }
      }
      d.index = index;
      const ref = sibs[index] ?? sibs[sibs.length - 1];
      if (ref) {
        const b = r.rectOf(ref);
        setInsertLine(sibs[index] ? { x: b.x, y: b.y - 2, w: b.w, h: 3 } : { x: b.x, y: b.y + b.h + 1, w: b.w, h: 3 });
      }
      return;
    }
    d.inst.set('Position', movedPosition(d.inst, d.p0, dx, dy));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (s.mode === 'play') {
      const p = toDevice(e);
      engine.current?.runtime?.pointerUp(p.x, p.y, hits(e), e.button, e.pointerType === 'touch');
      return;
    }
    const d = drag.current;
    drag.current = null;
    setInsertLine(null);
    if (!d) return;
    if (d.kind === 'move' && d.layout && d.moved && d.index !== undefined) {
      if (!reorder(d.inst, d.index)) store.log('warn', `${d.inst.parent!.name}'s layout sorts by Name; rename items or set SortOrder to LayoutOrder to reorder them`);
    }
    if (d.kind === 'resize' || d.moved) store.commit();
  };

  const onWheel = (e: React.WheelEvent) => {
    if (s.mode !== 'play') return;
    const p = toDevice(e);
    engine.current?.runtime?.wheel(p.x, p.y, hits(e), e.deltaY);
  };

  // ---------- palette drops ----------
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw || s.mode === 'play') return;
    e.preventDefault();
    const data = JSON.parse(raw) as { kind: 'new'; cls: string } | { kind: 'dup'; path: number[] };
    const p = toDevice(e);
    const target = hits(e)[0] ?? store.root;
    if (data.kind === 'new' && PALETTE_MODIFIERS.includes(data.cls)) {
      const parent = target === store.root ? store.selection ?? store.root : target;
      store.select(createInstance(data.cls, parent));
      store.commit();
      return;
    }
    const r = engine.current!.renderer;
    const pr = r.rectOf(target);
    const at = { x: p.x - pr.x, y: p.y - pr.y };
    let made: Inst | null = null;
    if (data.kind === 'new') made = createInstance(data.cls, target, at);
    else {
      let src: Inst | undefined = store.root;
      for (const i of data.path) src = src?.children[i];
      if (src && src !== store.root) {
        made = target === src || target.isDescendantOf(src) ? duplicate(src, src.parent, at) : duplicate(src, target, at);
      }
    }
    if (made) { store.select(made); store.commit(); }
  };

  // ---------- overlay ----------
  engine.current?.renderer.layout();
  const rect = (i: Inst | null) => (i && isGuiObject(i.className) && engine.current ? engine.current.renderer.rectOf(i) : null);
  const sel = s.mode === 'edit' ? rect(s.selection) : null;
  const hov = s.mode === 'edit' && hover !== s.selection && hover && !hover.destroyed && hover.world === store.world ? rect(hover) : null;
  const box = (r: { x: number; y: number; w: number; h: number }) => ({ left: r.x * zoom, top: r.y * zoom, width: Math.max(1, r.w * zoom), height: Math.max(1, r.h * zoom) });

  return (
    <div className="canvas-host" ref={hostRef}>
      <div className="device" style={{ width: dev.w * zoom, height: dev.h * zoom }}>
        <div
          ref={screenRef}
          className={`screen backdrop-${s.backdrop} ${s.mode}`}
          style={{ width: dev.w, height: dev.h, transform: `scale(${zoom})` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => { setHover(null); if (s.mode === 'play') engine.current?.runtime?.pointerLeave(); }}
          onWheel={onWheel}
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault(); }}
          onDrop={onDrop}
          onContextMenu={(e) => s.mode === 'play' && e.preventDefault()}
        >
          <div className="surface" ref={surfaceRef} />
          {s.showTopbar && (
            <div className="topbar" style={{ height: TOPBAR }}>
              <span /><span />
            </div>
          )}
          {(dev.safe.l > 0 || dev.safe.t > 0) && s.mode === 'edit' && (
            <div className="safe" style={{ left: dev.safe.l, top: dev.safe.t, right: dev.safe.r, bottom: dev.safe.b }} />
          )}
        </div>
        <div className="overlay">
          {hov && <div className="hover-box" style={box(hov)} />}
          {insertLine && <div className="insert-line" style={box(insertLine)} />}
          {sel && (
            <div className="sel-box" style={box(sel)}>
              <span className="sel-label">{s.selection!.name}</span>
              {HANDLES.map((h) => (
                <div key={h} className={`handle h-${h}`} data-handle={h}
                  onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e); (screenRef.current!).setPointerCapture(e.pointerId); }}
                  onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="canvas-info">
        {dev.w}×{dev.h} · {Math.round(zoom * 100)}%{s.mode === 'play' ? ' · Playing' : ' · Double-click to select inside, Alt+click for the innermost'}
        {sel && s.selection && <> · {s.selection.name} {Math.round(sel.w)}×{Math.round(sel.h)} at {Math.round(sel.x)},{Math.round(sel.y - (s.root.box.y))}</>}
      </div>
    </div>
  );
}

