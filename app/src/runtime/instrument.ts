// Inserts a cheap loop counter after every `do` and `repeat` so runaway loops hit a script timeout
// instead of freezing the app (Luau's own interrupt hook costs ~100x in tight loops here).
// Insertions stay on the same line, so error line numbers are unchanged.

const LOOP_KEYWORDS = new Set(['do', 'repeat']);

export function instrument(src: string): string {
  const out: string[] = ['local __rbxc = __rbxc; '];
  let i = 0, last = 0;
  const n = src.length;
  // Stack of brace depths for backtick strings with {expressions}.
  const interp: number[] = [];
  let braceDepth = 0;

  const longBracket = (at: number): number => {
    const m = /^\[(=*)\[/.exec(src.slice(at, at + 64));
    if (!m) return -1;
    const close = src.indexOf(`]${m[1]}]`, at + m[0].length);
    return close < 0 ? n : close + m[1].length + 2;
  };
  const skipQuoted = (at: number, q: string): number => {
    let j = at + 1;
    while (j < n && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  // Scans a backtick string from `at` (just after the opening backtick or a closing `}`) to its end or the next `{`.
  const scanBacktick = (at: number): number => {
    let j = at;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') return j + 1;
      if (src[j] === '{') { interp.push(braceDepth); braceDepth = 0; return j + 1; }
      j++;
    }
    return n;
  };

  while (i < n) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') {
      const lb = src[i + 2] === '[' ? longBracket(i + 2) : -1;
      if (lb >= 0) i = lb;
      else { const e = src.indexOf('\n', i); i = e < 0 ? n : e; }
      continue;
    }
    if (c === '"' || c === "'") { i = skipQuoted(i, c); continue; }
    if (c === '[') { const lb = longBracket(i); if (lb >= 0) { i = lb; continue; } i++; continue; }
    if (c === '`') { i = scanBacktick(i + 1); continue; }
    if (c === '{') { braceDepth++; i++; continue; }
    if (c === '}') {
      if (braceDepth === 0 && interp.length) { braceDepth = interp.pop()!; i = scanBacktick(i + 1); continue; }
      braceDepth--; i++; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let p = i - 1;
      while (p >= 0 && /\s/.test(src[p])) p--;
      const prev = p >= 0 ? src[p] : '';
      if (LOOP_KEYWORDS.has(word) && prev !== '.' && prev !== ':') {
        out.push(src.slice(last, j), ' __rbxc();');
        last = j;
      }
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j++; i = j; continue; }
    i++;
  }
  out.push(src.slice(last));
  return out.join('');
}
