import './app-config.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import '@stella/web-core/core.css';
import '@stella/web-core/desk.css';
// Das Theme zuletzt: seine Variablen (Farben, Rundung) gelten für alles davor
import './theme.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service Worker:', err));
}
