// Roblox RichText -> DOM. Only whitelisted tags become elements; everything else is text, so file content
// can never inject markup. MaxVisibleGraphemes hides characters without reflowing, like Roblox.
import { cssFamily } from './fonts';

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const decode = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ENTITIES[e]);
const WEIGHTS: Record<string, number> = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, heavy: 900 };

function color(v: string): string | null {
  let m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(v.trim());
  if (m) return `#${m[1]}`;
  m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(v.trim());
  return m ? `rgb(${m[1]},${m[2]},${m[3]})` : null;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null;
const graphemes = (s: string) => (segmenter ? [...segmenter.segment(s)].map((g) => g.segment) : [...s]);

/** Fills `el` with `text`. `max` < 0 shows everything. */
export function buildText(el: HTMLElement, text: string, rich: boolean, max = -1) {
  el.textContent = '';
  let shown = 0;
  const append = (parent: Node, s: string) => {
    if (!s) return;
    if (max < 0) { parent.appendChild(document.createTextNode(s)); return; }
    const g = graphemes(s);
    const visible = Math.max(0, Math.min(g.length, max - shown));
    shown += g.length;
    if (visible) parent.appendChild(document.createTextNode(g.slice(0, visible).join('')));
    if (visible < g.length) {
      const hidden = document.createElement('span');
      hidden.style.visibility = 'hidden';
      hidden.textContent = g.slice(visible).join('');
      parent.appendChild(hidden);
    }
  };
  if (!rich) { append(el, text); return; }

  const stack: { tag: string; node: HTMLElement }[] = [{ tag: '', node: el }];
  const top = () => stack[stack.length - 1].node;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    append(top(), decode(text.slice(last, m.index)));
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const [, closing, rawTag, rawAttrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (tag === 'br') { top().appendChild(document.createElement('br')); continue; }
    if (closing) {
      const i = stack.map((s) => s.tag).lastIndexOf(tag === 'uc' ? 'uppercase' : tag === 'sc' ? 'smallcaps' : tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([a-zA-Z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3];
    const span = document.createElement('span');
    const st = span.style;
    let name = tag;
    switch (tag) {
      case 'b': st.fontWeight = '700'; break;
      case 'i': st.fontStyle = 'italic'; break;
      case 'u': st.textDecoration = 'underline'; break;
      case 's': st.textDecoration = 'line-through'; break;
      case 'uppercase': case 'uc': name = 'uppercase'; st.textTransform = 'uppercase'; break;
      case 'smallcaps': case 'sc': name = 'smallcaps'; st.fontVariant = 'small-caps'; break;
      case 'font': {
        const c = attrs.color && color(attrs.color);
        if (c) st.color = c;
        if (attrs.size && !Number.isNaN(+attrs.size)) st.fontSize = `${+attrs.size}px`;
        if (attrs.face) st.fontFamily = cssFamily(attrs.face);
        if (attrs.family) st.fontFamily = cssFamily(attrs.family);
        if (attrs.weight) st.fontWeight = String(WEIGHTS[attrs.weight.toLowerCase()] ?? (+attrs.weight || 400));
        if (attrs.transparency) st.opacity = String(1 - Math.min(1, Math.max(0, +attrs.transparency || 0)));
        break;
      }
      case 'stroke': {
        const c = color(attrs.color ?? '#000000') ?? '#000';
        const t = Math.max(0, +(attrs.thickness ?? 1) || 1);
        st.setProperty('-webkit-text-stroke', `${t * 2}px ${c}`);
        st.setProperty('paint-order', 'stroke fill');
        break;
      }
      case 'mark': {
        const c = color(attrs.color ?? '#ffff00') ?? '#ff0';
        st.backgroundColor = c;
        if (attrs.transparency) st.backgroundColor = `color-mix(in srgb, ${c} ${(1 - (+attrs.transparency || 0)) * 100}%, transparent)`;
        break;
      }
      default:
        append(top(), m[0]);
        continue;
    }
    top().appendChild(span);
    if (!selfClose) stack.push({ tag: name, node: span });
  }
  append(top(), decode(text.slice(last)));
}
