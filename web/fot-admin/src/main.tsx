import { Fragment, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initErrorReporter } from '@fot/shared';
import { getApiBase } from './lib/apiBase';
import { App } from './App';
import { installDesktopInputHeal } from './lib/desktopInputHeal';
import './index.css';

installDesktopInputHeal();

function showBootError(message: string) {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="font-family:system-ui,sans-serif;padding:2rem;text-align:center;direction:rtl;min-height:100vh;background:#0f172a;color:#e2e8f0;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <h1 style="font-size:1.1rem;margin:0 0 .5rem">تعذّر تشغيل لوحة التحكم</h1>
      <p style="color:#94a3b8;font-size:.875rem;margin:0 0 1rem">${message}</p>
      <button type="button" onclick="location.reload()" style="padding:.5rem 1rem;border-radius:.75rem;border:0;background:#0f9f76;color:#fff;cursor:pointer">إعادة المحاولة</button>
    </div>
  `;
}

initErrorReporter({
  source: 'admin',
  getApiBase: getApiBase,
  getToken: () => localStorage.getItem('fot_admin_token'),
  getAppVersion: () => '2.2.9',
  isDev: import.meta.env.DEV,
});

const Root = import.meta.env.DEV ? StrictMode : Fragment;

try {
  createRoot(document.getElementById('root')!).render(
    <Root>
      <App />
    </Root>,
  );
} catch (error) {
  showBootError(error instanceof Error ? error.message : 'خطأ غير متوقع');
}

window.addEventListener('unhandledrejection', event => {
  const msg = event.reason instanceof Error ? event.reason.message : String(event.reason ?? '');
  if (/Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError/i.test(msg)) {
    try {
      if (sessionStorage.getItem('fot_chunk_reload') !== '1') {
        sessionStorage.setItem('fot_chunk_reload', '1');
        window.location.reload();
      }
    } catch {
      /* ignore */
    }
  }
  console.error('Unhandled rejection:', event.reason);
});
