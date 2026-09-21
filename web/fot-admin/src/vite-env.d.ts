/// <reference types="vite/client" />

import type { FotDesktopBridge } from '@fot/shared';

export {};

declare global {
  interface Window {
    fotDesktop?: FotDesktopBridge;
    __fotAppReady?: boolean;
  }
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
