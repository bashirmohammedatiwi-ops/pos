import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:5000';
  const bundled = env.VITE_ANDROID === '1' || env.VITE_ELECTRON === '1';

  return {
    base: bundled ? './' : mode === 'development' ? '/' : '/price/',
    plugins: [react()],
    build: {
      target: 'es2015',
      cssTarget: 'chrome49',
      assetsInlineLimit: 0,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@fot/shared': path.resolve(__dirname, '../packages/fot-shared/src/index.ts'),
      },
    },
    server: {
      host: true,
      port: 5175,
      strictPort: true,
      proxy: {
        '/api': proxyTarget,
        '/health': proxyTarget,
      },
    },
    preview: {
      host: true,
      port: 5175,
      strictPort: true,
    },
  };
});
