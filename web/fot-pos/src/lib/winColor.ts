/** Win32 COLORREF (0x00BBGGRR) used by Edari/WPF group tiles. */
export function winRgb(color: number | null | undefined): { r: number; g: number; b: number } | null {
  if (!color) return null;
  return {
    r: color & 0xff,
    g: (color >> 8) & 0xff,
    b: (color >> 16) & 0xff,
  };
}

export function winCss(color: number | null | undefined, fallback: string): string {
  const rgb = winRgb(color);
  if (!rgb) return fallback;
  if (rgb.r > 240 && rgb.g > 240 && rgb.b > 240) return fallback;
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

export function isDarkRgb(color: number | null | undefined): boolean {
  const rgb = winRgb(color);
  if (!rgb) return false;
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 < 140;
}
