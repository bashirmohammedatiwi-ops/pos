import { lazy, type ComponentType } from 'react';

function isChunkError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically imported module|ChunkLoadError/i.test(msg);
}

export function lazyPage(loader: () => Promise<Record<string, ComponentType<any>>>, name: string) {
  return lazy(async () => {
    try {
      const mod = await loader();
      return { default: mod[name] };
    } catch (error) {
      if (isChunkError(error)) {
        try {
          if (sessionStorage.getItem('fot_chunk_reload') !== '1') {
            sessionStorage.setItem('fot_chunk_reload', '1');
            window.location.reload();
            return await new Promise<never>(() => undefined);
          }
        } catch {
          /* ignore */
        }
      }
      throw error;
    }
  });
}

export function markAppReady() {
  window.__fotAppReady = true;
  try {
    sessionStorage.removeItem('fot_boot_reloads');
    sessionStorage.removeItem('fot_chunk_reload');
  } catch {
    /* ignore */
  }
}
