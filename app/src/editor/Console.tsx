import { useEffect, useRef, useState } from 'react';
import { store, useStore } from './store';

export function Console() {
  const s = useStore();
  const [open, setOpen] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const errors = s.logs.filter((l) => l.kind === 'error').length;
  const last = s.logs[s.logs.length - 1]?.id;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [last, open]);
  return (
    <div className={`panel console${open ? '' : ' closed'}`}>
      <div className="panel-head">
        <button className="link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Output</button>
        {errors > 0 && <span className="err-count">{errors} error{errors > 1 ? 's' : ''}</span>}
        <span className="spacer" />
        <button className="link" onClick={() => store.clearLogs()}>Clear</button>
      </div>
      {open && (
        <div className="panel-body logs">
          {s.logs.map((l) => (
            <div key={l.id} className={`log ${l.kind}`} title={l.trace}>
              <span className="time">{new Date(l.time).toLocaleTimeString()}</span>
              <span className="msg">{l.msg}</span>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </div>
  );
}
