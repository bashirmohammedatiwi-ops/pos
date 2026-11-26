/* عامل خدمة موقع فريق ديما: إشعارات الموقع فقط — لا يخزّن الصفحات (التحديث يبقى فورياً). */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : 'ديما · الفريق' };
  }
  const title = data.title || 'ديما · الفريق';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: 'team-icon.png',
      badge: 'team-icon.png',
      dir: 'rtl',
      lang: 'ar',
      data: { link: data.link || '/', kind: data.kind || 'staff' },
    }),
  );
});

/** الرابط داخل التطبيق: روابط المدير تبدأ بـ /m */
function target(data) {
  let link = String((data && data.link) || '/');
  if (!link.startsWith('/')) link = `/${link}`;
  if (data && data.kind === 'manager' && !link.startsWith('/m')) link = link === '/' ? '/m' : `/m${link}`;
  return `${self.registration.scope}#${link}`;
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = target(event.notification.data);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (w.url.startsWith(self.registration.scope)) {
          await w.focus();
          w.postMessage({ type: 'fot-open', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
