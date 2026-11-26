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
import './manager.css';
import './refresh.css';
import './web.css';
import { isNative } from '../config';

/* نقطة دخول تطبيق الهاتف — منفصلة عن الويب (تصميم وترتيب مختلفان تماماً).
 * نفس البناء يُنشر أيضاً كموقع على خادم الفريق (/staff/): html.web يفعّل إطار الحاسبة. */

document.documentElement.classList.add(isNative() ? 'native' : 'web');
applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <TeamApp />
    </HashRouter>
  </StrictMode>,
);
