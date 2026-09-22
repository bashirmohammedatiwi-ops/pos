/// <reference types="vite/client" />

interface Window {
  __fotAppMounted?: boolean;
  __fotMarkMounted?: () => void;
  __fotShowBoot?: (msg?: string) => void;
  __fotResetManager?: () => void;
}
