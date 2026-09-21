/**
 * محررات الأقسام الثلاثة تعمل داخل التطبيق (بلا نوافذ متصفح منفصلة).
 * «تعديل» يفتح المحرر كاملاً وفوقه مباشرة نافذة إضافة/إزالة الأصناف.
 * الدوال هنا للتوافق: روابط /editor/* القديمة ما زالت تعمل، وأي تغيير
 * في نافذة محرر ينبّه التطبيق الأب لتحديث بياناته.
 */

export type EditorKind = 'offer' | 'group' | 'target';

export function appUrl(path: string): string {
  const hashRouted = window.location.hash.startsWith('#/');
  return hashRouted ? `${window.location.pathname}#${path}` : path;
}

/** فتح المحرر داخل نفس التطبيق — دون نوافذ متصفح منفصلة. */
export function openEditorWindow(kind: EditorKind, id: number | 'new') {
  window.location.assign(appUrl(`/editor/${kind}/${id}`));
}

/** يُستدعى من داخل نافذة المحرر بعد أي تغيير — يحدّث التطبيق الأب. */
export function notifyOpenerRefresh() {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'fot-editor-changed' }, window.location.origin);
    }
  } catch { /* الأب مغلق أو مجال مختلف */ }
}

/** يُستخدم في التطبيق الأب — يستمع لتغييرات نوافذ المحرر. */
export function listenEditorChanges(onChanged: () => void) {
  const handler = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'fot-editor-changed') onChanged();
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** إغلاق نافذة المحرر مع إبلاغ الأب — أو العودة للخلف إن كنا في نفس التبويب. */
export function closeEditorWindow() {
  notifyOpenerRefresh();
  if (window.opener && !window.opener.closed) {
    window.close();
  } else if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.assign(appUrl('/'));
  }
}
