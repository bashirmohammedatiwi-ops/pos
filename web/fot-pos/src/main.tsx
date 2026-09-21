import { Fragment, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initErrorReporter } from '@fot/shared';
import { getApiBase } from './lib/apiBase';
import { App } from './App';
import './index.css';

// POS terminals are unattended — any JS error must reach the server's client-error log
// (batched, rate-capped, queued offline) so the admin can see a failing terminal remotely.
initErrorReporter({
  source: 'pos',
  getApiBase: getApiBase,
  getToken: () => localStorage.getItem('fot_pos_token'),
  getTerminal: () => localStorage.getItem('fot_pos_hwid'),
  getAppVersion: () => '2.2.9',
  isDev: import.meta.env.DEV,
});

const Root = import.meta.env.DEV ? StrictMode : Fragment;

/**
 * أمن الجلسة: كل إقلاع جديد للتطبيق يطلب تسجيل دخولاً جديداً.
 * في سطح المكتب نستهلك علامة "إقلاع جديد" من العملية الرئيسية — لا تُصفَّر عند
 * إعادة التحميل العلاجية للعارض (بعد انهيار مثلاً) فتبقى الجلسة أثناء العمل.
 * في المتصفح نستخدم علامة جلسة التبويب للتمييز بين تحديث الصفحة وفتح جديد.
 */
async function prepareBoot() {
  try {
    let fresh = false;
    if (window.fotDesktop?.consumeFreshLaunch) {
      fresh = await window.fotDesktop.consumeFreshLaunch();
    } else {
      fresh = !sessionStorage.getItem('fot_pos_boot');
      sessionStorage.setItem('fot_pos_boot', '1');
    }
    if (fresh) {
      localStorage.removeItem('fot_pos_token');
      localStorage.removeItem('fot_pos_session');
    }
  } catch {
    /* لا نمنع الإقلاع أبداً */
  }
}

void prepareBoot().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <Root>
      <App />
    </Root>,
  );
});
