import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { MANAGER_URL } from '../config';
import { getToken } from '../api';
import { getTeamToken } from '../team';
import { TeamApp } from './AppRoot';
import { applyTheme } from './native';
import './app.css';

/* نقطة دخول تطبيق الهاتف — منفصلة عن الويب (تصميم وترتيب مختلفان تماماً). */

applyTheme();

// مدير سجّل دخوله سابقاً: نفتح تطبيق المدراء مباشرة
if (!getTeamToken() && !getToken() && localStorage.getItem('fot_manager_token') && !location.hash.includes('/login')) {
  location.replace(MANAGER_URL);
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <TeamApp />
      </HashRouter>
    </StrictMode>,
  );
}
