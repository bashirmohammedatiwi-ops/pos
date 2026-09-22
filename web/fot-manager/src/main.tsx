import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { RootErrorBoundary } from './RootErrorBoundary';
import { ToastHost } from './ui';
import './boot-fallback.css';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  window.__fotShowBoot?.('تعذّر تهيئة الصفحة.');
} else {
  try {
    createRoot(rootEl).render(
      <StrictMode>
        <RootErrorBoundary>
          <BrowserRouter>
            <ToastHost>
              <App />
            </ToastHost>
          </BrowserRouter>
        </RootErrorBoundary>
      </StrictMode>,
    );
    document.getElementById('boot-fallback')?.classList.remove('show');
  } catch (e) {
    console.error('FOT Manager mount failed', e);
    window.__fotShowBoot?.('تعذّر تشغيل التطبيق على هذا الجهاز. جرّب مسح الذاكرة أو متصفحاً أحدث.');
  }
}
