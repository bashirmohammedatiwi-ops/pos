import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 4703,
    strictPort: true,
    proxy: {
      '/auth': 'http://127.0.0.1:5000',
      '/api': 'http://127.0.0.1:5000',
    },
  },
  preview: {
    host: true,
    port: 4703,
    strictPort: true,
    proxy: {
      '/auth': 'http://127.0.0.1:5000',
      '/api': 'http://127.0.0.1:5000',
    },
  },
});
