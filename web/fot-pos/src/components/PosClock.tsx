import { useEffect, useState } from 'react';

export function PosClock() {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setClock(new Date());
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="pos-clock num">
      {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}
