import { useCallback, useEffect, useState } from 'react';

const KEY = 'fot_pos_fullscreen';

function isDomFullscreen() {
  return Boolean(document.fullscreenElement);
}

export function useFullscreen() {
  const [active, setActive] = useState(() => isDomFullscreen());

  const refresh = useCallback(async () => {
    if (window.fotDesktop?.getFullScreen) {
      setActive(await window.fotDesktop.getFullScreen());
      return;
    }
    setActive(isDomFullscreen());
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => setActive(isDomFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [refresh]);

  const toggle = useCallback(async () => {
    if (window.fotDesktop?.toggleFullScreen) {
      const next = await window.fotDesktop.toggleFullScreen();
      setActive(next);
      localStorage.setItem(KEY, next ? '1' : '0');
      return next;
    }
    try {
      if (isDomFullscreen()) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* browser blocked fullscreen without gesture */
    }
    const next = isDomFullscreen();
    setActive(next);
    localStorage.setItem(KEY, next ? '1' : '0');
    return next;
  }, []);

  return { active, toggle };
}
