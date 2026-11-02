// File open/save for the Tauri app (native dialogs + Rust file commands) and the browser (picker + download).
import { generateLua } from '../core/luagen';
import { RblxuiError, stringifyRblxui } from '../core/rblxui';
import { generateRbxmx } from '../core/rbxmx';
import { store } from './store';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function tauri() {
  const [{ invoke }, dialog] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/plugin-dialog')]);
  return { invoke, dialog };
}

const FILTER = [{ name: 'Roblox UI', extensions: ['rblxui', 'json'] }];

export function openText(text: string, path: string | null, name?: string) {
  try {
    const warnings = store.load(text, path, name);
    store.log('info', `Opened ${store.name}${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`);
  } catch (e) {
    store.log('error', e instanceof RblxuiError ? `Could not open file: ${e.message}` : String(e));
  }
}

export async function confirmDiscard(): Promise<boolean> {
  if (!store.dirty) return true;
  if (isTauri) {
    const { dialog } = await tauri();
    return dialog.confirm('You have unsaved changes. Discard them?', { title: 'Roblox UI Builder', kind: 'warning' });
  }
  return window.confirm('You have unsaved changes. Discard them?');
}

export async function openFile() {
  if (!(await confirmDiscard())) return;
  if (isTauri) {
    const { invoke, dialog } = await tauri();
    const path = await dialog.open({ multiple: false, directory: false, filters: FILTER });
    if (typeof path !== 'string') return;
    openText(await invoke<string>('read_text', { path }), path);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.rblxui,.json';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) openText(await f.text(), null, f.name.replace(/\.(rblxui|json)$/i, ''));
  };
  input.click();
}

async function writeOut(text: string, suggested: string, ext: string, kind: string, path?: string | null): Promise<string | null> {
  if (isTauri) {
    const { invoke, dialog } = await tauri();
    const target = path ?? (await dialog.save({ defaultPath: suggested, filters: [{ name: kind, extensions: [ext] }] }));
    if (!target) return null;
    await invoke('write_text', { path: target, contents: text });
    return target;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggested;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return suggested;
}

export async function saveFile(saveAs = false) {
  try {
    const text = stringifyRblxui(store.file());
    const path = await writeOut(text, `${store.name}.rblxui`, 'rblxui', 'Roblox UI', saveAs ? null : store.path);
    if (!path) return;
    if (isTauri) {
      store.set('path', path);
      store.set('name', path.split(/[\\/]/).pop()!.replace(/\.rblxui$/i, ''));
    }
    store.set('dirty', false);
    store.log('info', `Saved ${path}`);
  } catch (e) {
    store.log('error', `Save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function exportAs(kind: 'lua' | 'rbxmx') {
  try {
    const text = kind === 'lua' ? generateLua(store.root) : generateRbxmx(store.root);
    const path = await writeOut(text, `${store.name}.${kind}`, kind, kind === 'lua' ? 'Lua script' : 'Roblox model', null);
    if (path) store.log('info', `Exported ${path}`);
  } catch (e) {
    store.log('error', `Export failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Files opened by double-click / "Open with" arrive from the Rust side. */
export async function listenForOpenedFiles() {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const take = async () => {
    const f = await invoke<[string, string] | null>('take_opened_file');
    if (f && (await confirmDiscard())) openText(f[1], f[0]);
  };
  await listen('file-opened', take);
  await take();
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setTitle(title);
}

export async function guardClose() {
  if (isTauri) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await win.onCloseRequested(async (e) => { if (!(await confirmDiscard())) e.preventDefault(); });
  } else {
    window.addEventListener('beforeunload', (e) => { if (store.dirty) e.preventDefault(); });
  }
}
