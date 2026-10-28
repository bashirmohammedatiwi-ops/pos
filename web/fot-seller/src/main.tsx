import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { isNative } from './config';
import { App } from './App';
import { ToastHost } from './ui';
import './index.css';
import './design.css';

// داخل تطبيق الهاتف تُقدَّم الملفات محلياً فنستخدم الروابط بعلامة #
const Router = isNative() ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <ToastHost>
        <App />
      </ToastHost>
    </Router>
  </StrictMode>,
);
