import { useEffect, useState } from 'react';
import { defaultsOf, groupOf, isScript } from '../core/classes';
import { ENUMS } from '../core/enums';
import type { Inst } from '../core/instance';
import { parseLiteral, toLiteral } from '../core/literal';
import { type Color3, type Font, type UDim, type UDim2, type Value, type Vector2, equals, font, rgb, toByte, typeOf, udim, udim2, v2 } from '../core/values';
import { familyName } from '../render/fonts';
import { uniqueName } from './ops';
import { store, useStore } from './store';

const GROUPS = ['Properties', 'Text', 'Image', 'Appearance', 'Layout', 'Scrolling', 'Behavior'];
const FAMILIES = ['GothamSSm', 'BuilderSans', 'SourceSansPro', 'Roboto', 'RobotoCondensed', 'RobotoMono', 'Arimo', 'Arial', 'LegacyArial',
  'Inconsolata', 'Nunito', 'Oswald', 'Ubuntu', 'Merriweather', 'Sarpanch', 'TitilliumWeb', 'AmaticSC', 'GrenzeGotisch', 'JosefinSans', 'Jura',
  'Kalam', 'ComicNeueAngular', 'PressStart2P', 'FredokaOne', 'LuckiestGuy', 'Bangers', 'Michroma', 'PermanentMarker', 'IndieFlower',
  'Creepster', 'DenkOne', 'Fondamento', 'PatrickHand', 'SpecialElite', 'Balthazar'];
const WEIGHTS: [number, string][] = [[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Heavy']];

/** Text field that edits a draft and commits on Enter/blur. */
function Field({ value, onCommit, disabled, className, multiline, validate }: {
  value: string; onCommit: (v: string) => void; disabled?: boolean; className?: string; multiline?: boolean; validate?: (v: string) => boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const bad = validate ? !validate(draft) : false;
  const commit = () => { if (draft !== value && !bad) onCommit(draft); else if (bad) setDraft(value); };
  const props = {
    value: draft, disabled, className: `${className ?? ''}${bad ? ' bad' : ''}`, spellCheck: false,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); (e.target as HTMLElement).blur(); }
      if (e.key === 'Escape') { setDraft(value); }
    },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}

const num = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));
const fmt = (n: number) => String(+n.toFixed(4));

function NumField({ value, onCommit, disabled, title }: { value: number; onCommit: (n: number) => void; disabled?: boolean; title?: string }) {
  return (
    <label className="num" title={title}>
      {title && <span>{title}</span>}
      <Field value={fmt(value)} validate={num} onCommit={(v) => onCommit(Number(v))} disabled={disabled} />
    </label>
  );
}

function ValueEditor({ k, value, set, disabled }: { k: string; value: Value; set: (v: Value) => void; disabled: boolean }) {
  const t = typeOf(value);
  if (t === 'boolean') return <input type="checkbox" checked={value as boolean} disabled={disabled} onChange={(e) => set(e.target.checked)} />;
  if (t === 'number') return <NumField value={value as number} onCommit={set} disabled={disabled} />;
  if (t === 'string') return <Field value={value as string} onCommit={set} disabled={disabled} multiline={k === 'Text' || k === 'Source'} className="wide" />;
  if (t === 'Enum') {
    const e = value as { e: string; n: string };
    const items = ENUMS[e.e];
    if (items) {
      return (
        <select value={e.n} disabled={disabled} onChange={(ev) => set({ t: 'Enum', e: e.e, n: ev.target.value })}>
          {Object.entries(items).sort((a, b) => a[1] - b[1]).map(([n]) => <option key={n}>{n}</option>)}
        </select>
      );
    }
  }
  if (t === 'Color3') {
    const c = value as Color3;
    const hex = '#' + [c.r, c.g, c.b].map((x) => toByte(x).toString(16).padStart(2, '0')).join('');
    return (
      <span className="color">
        <input type="color" value={hex} disabled={disabled} onChange={(e) => {
          const h = e.target.value;
          set(rgb(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)));
        }} />
        <Field value={[c.r, c.g, c.b].map(toByte).join(', ')} disabled={disabled}
          validate={(v) => /^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/.test(v)}
          onCommit={(v) => { const [r, g, b] = v.split(',').map(Number); set(rgb(r, g, b)); }} />
      </span>
    );
  }
  if (t === 'UDim2') {
    const u = value as UDim2;
    return (
      <span className="udim2">
        <span className="pair">X <NumField title="S" value={u.xs} disabled={disabled} onCommit={(n) => set(udim2(n, u.xo, u.ys, u.yo))} /><NumField title="O" value={u.xo} disabled={disabled} onCommit={(n) => set(udim2(u.xs, n, u.ys, u.yo))} /></span>
        <span className="pair">Y <NumField title="S" value={u.ys} disabled={disabled} onCommit={(n) => set(udim2(u.xs, u.xo, n, u.yo))} /><NumField title="O" value={u.yo} disabled={disabled} onCommit={(n) => set(udim2(u.xs, u.xo, u.ys, n))} /></span>
      </span>
    );
  }
  if (t === 'UDim') {
    const u = value as UDim;
    return <span className="pair"><NumField title="S" value={u.s} disabled={disabled} onCommit={(n) => set(udim(n, u.o))} /><NumField title="O" value={u.o} disabled={disabled} onCommit={(n) => set(udim(u.s, n))} /></span>;
  }
  if (t === 'Vector2') {
    const p = value as Vector2;
    return <span className="pair"><NumField title="X" value={p.x} disabled={disabled} onCommit={(n) => set(v2(n, p.y))} /><NumField title="Y" value={p.y} disabled={disabled} onCommit={(n) => set(v2(p.x, n))} /></span>;
  }
  if (t === 'Font') {
    const f = value as Font;
    const fam = familyName(f.family);
    return (
      <span className="font">
        <select value={FAMILIES.includes(fam) ? fam : ''} disabled={disabled} onChange={(e) => set(font(`rbxasset://fonts/families/${e.target.value}.json`, f.weight, f.style))}>
          {!FAMILIES.includes(fam) && <option value="">{fam}</option>}
          {FAMILIES.map((n) => <option key={n}>{n}</option>)}
        </select>
        <select value={f.weight} disabled={disabled} onChange={(e) => set(font(f.family, Number(e.target.value), f.style))}>
          {WEIGHTS.map(([w, n]) => <option key={w} value={w}>{n}</option>)}
        </select>
        <label className="italic"><input type="checkbox" checked={f.style === 'Italic'} disabled={disabled} onChange={(e) => set(font(f.family, f.weight, e.target.checked ? 'Italic' : 'Normal'))} />I</label>
      </span>
    );
  }
  const valid = (v: string) => { try { parseLiteral(v); return true; } catch { return false; } };
  return <Field value={toLiteral(value)} validate={valid} disabled={disabled} className="wide mono" onCommit={(v) => set(parseLiteral(v))} />;
}

function ScriptEditor({ inst, disabled }: { inst: Inst; disabled: boolean }) {
  const src = String(inst.get('Source') ?? '');
  // Local draft: the store re-renders a frame later, and a controlled textarea would jump the caret meanwhile.
  const [draft, setDraft] = useState(src);
  useEffect(() => setDraft(src), [src]);
  const update = (v: string) => { setDraft(v); inst.set('Source', v); };
  return (
    <textarea
      className="code"
      value={draft}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => update(e.target.value)}
      onBlur={() => store.commit()}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const ta = e.currentTarget, a = ta.selectionStart, b = ta.selectionEnd;
          update(draft.slice(0, a) + '\t' + draft.slice(b));
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = a + 1; });
        }
      }}
    />
  );
}

export function Inspector() {
  const s = useStore();
  const inst = s.selection && !s.selection.destroyed ? s.selection : s.root;
  const disabled = s.mode === 'play';
  const defs = defaultsOf(inst.className);
  const keys = [...new Set([...defs.keys(), ...inst.props.keys()])].filter((k) => k !== 'Source' && k !== 'Font');
  const groups = new Map<string, string[]>();
  for (const k of keys) {
    const g = groupOf(k);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(k);
  }
  const setProp = (k: string, v: Value) => { inst.set(k, v); store.commit(); };
  const scripts = inst.children.filter((c) => isScript(c.className));

  return (
    <div className="panel inspector">
      <div className="panel-head">
        <span className={`badge c-${inst.className}`}>{inst.className}</span>
        <Field className="name" value={inst.name} disabled={disabled} onCommit={(v) => { if (v.trim()) { inst.setName(v.trim()); store.commit(); } }} />
      </div>
      {disabled && <div className="note">Playing. Stop (F5) to edit. Changes made by scripts are not saved.</div>}
      <div className="panel-body">
        {isScript(inst.className) && (
          <section>
            <h3>Source</h3>
            <ScriptEditor inst={inst} disabled={disabled} />
          </section>
        )}
        {GROUPS.filter((g) => groups.has(g)).map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            {groups.get(g)!.map((k) => {
              const value = inst.get(k) ?? null;
              const explicit = inst.props.has(k);
              const isDefault = !explicit || equals(value, defs.get(k));
              return (
                <div className="row" key={k}>
                  <span className={`key${explicit ? ' set' : ''}`} title={explicit ? `${k} (set in file)` : `${k} (default)`}>{k}</span>
                  <ValueEditor k={k} value={value} set={(v) => setProp(k, v)} disabled={disabled} />
                  {explicit && defs.has(k) && (
                    <button className="reset" title={isDefault ? 'Remove from file' : 'Reset to default'} disabled={disabled} onClick={() => { inst.reset(k); store.commit(); }}>×</button>
                  )}
                </div>
              );
            })}
          </section>
        ))}
        <section>
          <h3>Attributes</h3>
          {[...inst.attrs].map(([k, v]) => (
            <div className="row" key={k}>
              <span className="key set">{k}</span>
              <ValueEditor k={k} value={v} set={(nv) => { inst.setAttr(k, nv); store.commit(); }} disabled={disabled} />
              <button className="reset" disabled={disabled} onClick={() => { inst.setAttr(k, null); store.commit(); }}>×</button>
            </div>
          ))}
          {!disabled && (
            <Field value="" className="wide add" validate={(v) => v === '' || /^[A-Za-z_][A-Za-z0-9_]{0,99}\s*=\s*.+$/.test(v)}
              onCommit={(v) => {
                const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(v);
                if (!m) return;
                try { inst.setAttr(m[1], parseLiteral(m[2])); store.commit(); } catch (e) { store.log('warn', `Attribute: ${(e as Error).message}`); }
              }} />
          )}
          {!disabled && <div className="hint">Add: <code>Name = Lua literal</code>, e.g. <code>Price = 25</code></div>}
        </section>
        {!isScript(inst.className) && (
          <section>
            <h3>Scripts</h3>
            {scripts.map((sc) => (
              <button key={sc.id} className="link" onClick={() => store.select(sc)}>{sc.className}: {sc.name}</button>
            ))}
            {!disabled && (
              <div className="buttons">
                {(['LocalScript', 'ModuleScript'] as const).map((cls) => (
                  <button key={cls} onClick={() => {
                    const sc = store.world.create(cls, uniqueName(inst, cls));
                    sc.set('Source', cls === 'LocalScript' ? 'local gui = script.Parent\n\n' : 'local module = {}\n\nreturn module\n');
                    sc.setParent(inst);
                    store.select(sc);
                    store.commit();
                  }}>+ {cls}</button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
