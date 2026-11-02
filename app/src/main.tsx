import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connectBridge } from './editor/bridge';
import { guardClose, listenForOpenedFiles, openText } from './editor/io';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

connectBridge();
guardClose();
listenForOpenedFiles();

// ?open=<url> loads a file at startup (used by the browser build and tests).
const url = new URLSearchParams(location.search).get('open');
if (url) fetch(url).then((r) => r.text()).then((t) => openText(t, null, url.split('/').pop()!.replace(/\.rblxui$/i, '')));
