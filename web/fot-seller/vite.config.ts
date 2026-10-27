import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// للتطوير: FOT_SELLER_API يوجّه الطلبات لخادم آخر (مثلاً نسخة hub محلية للتجربة)
const api = process.env.FOT_SELLER_API || 'http://127.0.0.1:5000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
