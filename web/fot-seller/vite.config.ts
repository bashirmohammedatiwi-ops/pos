import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// للتطوير: FOT_SELLER_API يوجّه الطلبات لخادم آخر (مثلاً نسخة hub محلية للتجربة)
const api = process.env.FOT_SELLER_API || 'http://127.0.0.1:5000';

// VITE_TARGET=app: تطبيق الهاتف — نقطة دخول وتصميم مستقلان عن الويب، بلا خطوط خارجية
const appTarget = process.env.VITE_TARGET === 'app';

const teamAppEntry: Plugin = {
  name: 'team-app-entry',
  transformIndexHtml: {
    order: 'pre',
    handler: html =>
      html
        .replace('/src/main.tsx', '/src/app/main.tsx')
        .replace(/\s*<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, '')
        .replace('content="#0b1324"', 'content="#f5f3ef"')
        .replace(/<link rel="manifest"[^>]*>\s*/, ''),
  },
};

export default defineConfig({
  plugins: [react(), ...(appTarget ? [teamAppEntry] : [tailwindcss()])],
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
