import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { TeamApp } from './AppRoot';
import { applyTheme } from './native';
import './app.css';
import './work.css';
import './live.css';
import './leave.css';
import './sales.css';
import './invoices.css';

/* نقطة دخول تطبيق الهاتف — منفصلة عن الويب (تصميم وترتيب مختلفان تماماً). */

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <TeamApp />
    </HashRouter>
  </StrictMode>,
);
