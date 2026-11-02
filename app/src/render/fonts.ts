// Roblox font families -> bundled web fonts (latin subset). Faces load lazily, only when a UI uses them.
// Gotham and Builder Sans are proprietary, so they use the closest open fonts (Montserrat, Inter).
import type { Font } from '../core/values';

const FILES = import.meta.glob([
  '/node_modules/@fontsource/montserrat/files/montserrat-latin-{300,400,500,600,700,800,900}-normal.woff2',
  '/node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-{300,400,600,700}-normal.woff2',
  '/node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-400-italic.woff2',
  '/node_modules/@fontsource/inter/files/inter-latin-{400,500,700,800}-normal.woff2',
  '/node_modules/@fontsource/arimo/files/arimo-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/roboto/files/roboto-latin-{300,400,500,700,900}-normal.woff2',
  '/node_modules/@fontsource/roboto-condensed/files/roboto-condensed-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/roboto-mono/files/roboto-mono-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/inconsolata/files/inconsolata-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/nunito/files/nunito-latin-{400,600,700,800,900}-normal.woff2',
  '/node_modules/@fontsource/oswald/files/oswald-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/ubuntu/files/ubuntu-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/merriweather/files/merriweather-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/sarpanch/files/sarpanch-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/titillium-web/files/titillium-web-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/amatic-sc/files/amatic-sc-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/grenze-gotisch/files/grenze-gotisch-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/josefin-sans/files/josefin-sans-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/jura/files/jura-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/kalam/files/kalam-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/comic-neue/files/comic-neue-latin-{400,700}-normal.woff2',
  '/node_modules/@fontsource/{press-start-2p,fredoka-one,luckiest-guy,bangers,michroma,permanent-marker,indie-flower,creepster,denk-one,fondamento,patrick-hand,special-elite,balthazar}/files/*-latin-400-normal.woff2',
], { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Roblox family file name -> fontsource package. */
const FAMILY_PKG: Record<string, string> = {
  GothamSSm: 'montserrat', Gotham: 'montserrat', SourceSansPro: 'source-sans-3', BuilderSans: 'inter', Arial: 'arimo', LegacyArial: 'arimo',
  Arimo: 'arimo', Roboto: 'roboto', RobotoCondensed: 'roboto-condensed', RobotoMono: 'roboto-mono', Inconsolata: 'inconsolata',
  Nunito: 'nunito', Oswald: 'oswald', Ubuntu: 'ubuntu', Merriweather: 'merriweather', Sarpanch: 'sarpanch', TitilliumWeb: 'titillium-web',
  AmaticSC: 'amatic-sc', GrenzeGotisch: 'grenze-gotisch', JosefinSans: 'josefin-sans', Jura: 'jura', Kalam: 'kalam',
  ComicNeueAngular: 'comic-neue', PressStart2P: 'press-start-2p', FredokaOne: 'fredoka-one', LuckiestGuy: 'luckiest-guy', Bangers: 'bangers',
  Michroma: 'michroma', PermanentMarker: 'permanent-marker', IndieFlower: 'indie-flower', Creepster: 'creepster', DenkOne: 'denk-one',
  Fondamento: 'fondamento', PatrickHand: 'patrick-hand', SpecialElite: 'special-elite', Balthazar: 'balthazar',
};
const FALLBACK: Record<string, string> = { AccanthisADFStd: 'serif', Guru: 'serif', HighwayGothic: 'sans-serif', Zekton: 'sans-serif' };

const registered = new Set<string>();

function register(pkg: string) {
  if (registered.has(pkg) || typeof document === 'undefined') return;
  registered.add(pkg);
  const re = new RegExp(`/${pkg}/files/${pkg}-latin-(\\d+)-(normal|italic)\\.woff2$`);
  for (const [path, url] of Object.entries(FILES)) {
    const m = re.exec(path);
    if (m) document.fonts.add(new FontFace(`rbx-${pkg}`, `url(${url})`, { weight: m[1], style: m[2] }));
  }
}

export function familyName(url: string): string {
  return /([A-Za-z0-9]+)\.json$/.exec(url)?.[1] ?? 'SourceSansPro';
}

/** CSS font-family for a Roblox FontFace. Unknown families fall back to Source Sans like Roblox does. */
export function cssFamily(face: Font | string): string {
  const name = typeof face === 'string' ? face : familyName(face.family);
  const pkg = FAMILY_PKG[name];
  if (pkg) { register(pkg); return `"rbx-${pkg}", sans-serif`; }
  if (FALLBACK[name]) return FALLBACK[name];
  register('source-sans-3');
  return '"rbx-source-sans-3", sans-serif';
}

export const SUBSTITUTED = { GothamSSm: 'Montserrat', BuilderSans: 'Inter' };
