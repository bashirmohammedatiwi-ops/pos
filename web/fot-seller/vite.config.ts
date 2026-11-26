import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// للتطوير: FOT_SELLER_API يوجّه الطلبات لخادم آخر (مثلاً نسخة hub محلية للتجربة)
const api = process.env.FOT_SELLER_API || 'http://127.0.0.1:5000';

// VITE_TARGET=app: تطبيق الهاتف — نقطة دخول وتصميم مستقلان عن الويب، بلا خطوط خارجية
const appTarget = process.env.VITE_TARGET === 'app';
// VITE_WEB=1: نفس التطبيق كموقع على خادم الفريق (/staff/) — قابل للتثبيت على الشاشة الرئيسية (الآيفون)
const webSite = appTarget && process.env.VITE_WEB === '1';
// رقم البناء: الموقع يقارنه بـ version.json المنشور ليحدّث نفسه (الآيفون يُبقي الموقع المثبّت قديماً)
const buildId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
const webVersion: Plugin = {
  name: 'team-web-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId, at: new Date().toISOString() }) });
  },
};

const teamAppEntry: Plugin = {
  name: 'team-app-entry',
  transformIndexHtml: {
    order: 'pre',
    handler: html => {
      const out = html
        .replace('/src/main.tsx', '/src/app/main.tsx')
        .replace(/\s*<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, '')
        .replace('content="#0b1324"', 'content="#f5f2fb"');
      if (!webSite) return out.replace(/<link rel="manifest"[^>]*>\s*/, '');
      return out
        .replace(/<link rel="manifest"[^>]*>/, '<link rel="manifest" href="/team.webmanifest" />')
        .replace('<link rel="apple-touch-icon" href="/icon.svg" />', '<link rel="apple-touch-icon" href="/team-icon.png" />')
        .replace('content="black-translucent"', 'content="default"')
        .replace('<title>', '<meta name="apple-mobile-web-app-title" content="ديما الفريق" />\n    <title>');
    },
  },
};

export default defineConfig({
  plugins: [react(), ...(appTarget ? [teamAppEntry] : [tailwindcss()]), ...(webSite ? [webVersion] : [])],
  define: { __BUILD_ID__: JSON.stringify(webSite ? buildId : 'dev') },
  server: {
    host: true,
    port: 4701,
    strictPort: true,
    proxy: {
      '/auth': api,
      '/api': api,
    },
  },
  preview: {
    host: true,
    port: 4701,
    strictPort: true,
    proxy: {
      '/auth': api,
      '/api': api,
    },
  },
});
