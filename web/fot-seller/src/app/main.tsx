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
import './login.css';
import './web.css';
import { isNative } from '../config';
import { captureInstallPrompt } from './Install';

/* نقطة دخول تطبيق الهاتف — منفصلة عن الويب (تصميم وترتيب مختلفان تماماً).
 * نفس البناء يُنشر أيضاً كموقع على خادم الفريق (/staff/): html.web يفعّل إطار الحاسبة. */

document.documentElement.classList.add(isNative() ? 'native' : 'web');
// الموقع: نافذة التثبيت تُلتقط مبكراً، وعامل الخدمة (الإشعارات + قابلية التثبيت) يُسجَّل من البداية
captureInstallPrompt();
if (!isNative() && window.isSecureContext && 'serviceWorker' in navigator) void navigator.serviceWorker.register('team-sw.js', { scope: './' }).catch(() => undefined);
applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <TeamApp />
    </HashRouter>
  </StrictMode>,
);
