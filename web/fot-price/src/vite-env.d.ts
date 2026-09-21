/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    fotPriceNative?: {
      getApiBase?: () => string;
      setApiBase?: (url: string) => void;
    };
    __fotAppReady?: boolean;
  }
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_PROXY_TARGET?: string;
  readonly VITE_ANDROID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
