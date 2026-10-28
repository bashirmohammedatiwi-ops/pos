import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { isNative } from './native';
import { App } from './App';
import { RootErrorBoundary } from './RootErrorBoundary';
import { ToastHost } from './ui';
import './index.css';
import './simple.css';

// داخل تطبيق الهاتف تُقدَّم الملفات محلياً فنستخدم الروابط بعلامة #
const Router = isNative() ? HashRouter : BrowserRouter;

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        <Router>
          <ToastHost>
            <App />
          </ToastHost>
        </Router>
      </RootErrorBoundary>
    </StrictMode>,
  );
}
