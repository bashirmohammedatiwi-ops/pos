/** Short error beep when a scanned article is missing. */
export function playErrorBeep() {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const tone = (at: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    };
    const t = ctx.currentTime;
    tone(t, 440, 0.11);
    tone(t + 0.15, 260, 0.2);
    window.setTimeout(() => void ctx.close(), 520);
  } catch {
    /* ignore locked or unsupported audio */
  }
}
