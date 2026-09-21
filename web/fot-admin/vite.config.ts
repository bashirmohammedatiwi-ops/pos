import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:5000';

  return {
    base: env.VITE_ELECTRON === '1' ? './' : '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@fot/shared': path.resolve(__dirname, '../packages/fot-shared/src/index.ts'),
      },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/auth': proxyTarget,
        '/api': proxyTarget,
        '/health': proxyTarget,
        '/hubs': { target: proxyTarget, ws: true },
      },
    },
    preview: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/auth': proxyTarget,
        '/api': proxyTarget,
        '/health': proxyTarget,
        '/hubs': { target: proxyTarget, ws: true },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
            signalr: ['@microsoft/signalr'],
          },
        },
      },
    },
  };
});
