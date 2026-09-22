const { BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MICRONS_PER_MM = 1000;
/** Most 80/58mm thermal heads are 203 dpi. */
const THERMAL_DPI = 203;

function receiptContentWidthMm(paperWidthMm) {
  // Leave a real hardware margin. Most "80 mm" mechanisms expose a
  // 72 mm head, while some generic Windows drivers expose slightly less.
  return paperWidthMm <= 58 ? 50 : 70;
}

function receiptThermalWidthPx(paperWidthMm) {
  return Math.round(receiptContentWidthMm(paperWidthMm) / 25.4 * THERMAL_DPI);
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runPowerShell(script) {
  const ps1 = path.join(os.tmpdir(), `fot-print-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
  fs.writeFileSync(ps1, `\uFEFF${script}`, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { windowsHide: true },
    );
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => {
      try { fs.unlinkSync(ps1); } catch { /* ignore */ }
      reject(err);
    });
    child.on('exit', code => {
      try { fs.unlinkSync(ps1); } catch { /* ignore */ }
      if (code === 0) resolve();
      else reject(new Error((stderr || `print exit ${code}`).trim()));
    });
  });
}

async function prepareTicket(win, contentPx) {
  const size = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const wait = () => {
        const ticket = document.querySelector('.ticket') || document.body;
        const box = ticket.getBoundingClientRect();
        resolve({
          w: Math.max(1, Math.ceil(box.width)),
          h: Math.max(1, Math.ceil(box.height)),
        });
      };

      const fonts = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
      const images = Array.from(document.images).map(img => img.complete
        ? Promise.resolve()
        : new Promise(done => {
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            setTimeout(done, 2000);
          }));
      Promise.all([fonts, ...images]).then(() => setTimeout(wait, 80));
    })
  `, true);

  const width = Math.max(contentPx, Number(size?.w) || contentPx);
  const height = Math.max(200, Number(size?.h) || 200);
  win.setContentSize(width, height + 4);
  await sleep(240);
  return { width, height: height + 4 };
}

async function withReceiptWindow(html, contentPx, prefs, fn) {
  const htmlPath = path.join(os.tmpdir(), `fot-rcpt-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  const win = new BrowserWindow({
    show: Boolean(prefs.show),
    x: prefs.x,
    y: prefs.y,
    width: contentPx,
    height: 900,
    useContentSize: true,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
      backgroundThrottling: false,
      offscreen: Boolean(prefs.offscreen),
      zoomFactor: 1,
    },
  });
  try {
    win.webContents.setZoomFactor(1);
    await win.loadFile(htmlPath);
    const size = await prepareTicket(win, contentPx);
    return await fn(win, size);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try { fs.unlinkSync(htmlPath); } catch { /* ignore */ }
  }
}

async function captureReceiptPng(html, widthMm) {
  const contentPx = receiptThermalWidthPx(widthMm);
  const tryCapture = async prefs => withReceiptWindow(html, contentPx, prefs, async (win, size) => {
    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    });
    const px = image?.getSize?.() || { width: 0, height: 0 };
    if (!image || image.isEmpty() || px.width < 80 || px.height < 80) {
      throw new Error('empty capture');
    }
    const pngPath = path.join(os.tmpdir(), `fot-rcpt-${Date.now()}.png`);
    fs.writeFileSync(pngPath, image.toPNG());
    return pngPath;
  });

  try {
    return await tryCapture({ offscreen: true, show: false });
  } catch {
    return tryCapture({ offscreen: false, show: true, x: -4800, y: -4800 });
  }
}

async function printPngGdi(pngPath, printerName, copies, widthMm) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile(${psQuote(pngPath)})
$img = $null
try {
  # Flatten Chromium's gray anti-aliased edges to pure black/white at the
  # thermal head's own 203 dpi. A mid threshold keeps thin Arabic strokes.
  $img = [System.Drawing.Bitmap]::new(
    $source.Width, $source.Height,
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  )
  $img.SetResolution(${THERMAL_DPI}, ${THERMAL_DPI})
  $raster = [System.Drawing.Graphics]::FromImage($img)
  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  try {
    $raster.Clear([System.Drawing.Color]::White)
    $raster.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $raster.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $attrs.SetThreshold(0.52)
    $dest = [System.Drawing.Rectangle]::new(0, 0, $source.Width, $source.Height)
    $raster.DrawImage(
      $source, $dest, 0, 0, $source.Width, $source.Height,
      [System.Drawing.GraphicsUnit]::Pixel, $attrs
    )
  } finally {
    $attrs.Dispose()
    $raster.Dispose()
    $source.Dispose()
    $source = $null
  }
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.DocumentName = 'FOT POS Receipt'
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  ${printerName ? `$doc.PrinterSettings.PrinterName = ${psQuote(printerName)}` : ''}
  if (-not $doc.PrinterSettings.IsValid) { throw 'تعريف الطابعة غير صالح' }
  $doc.OriginAtMargins = $false
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins 0,0,0,0
  $w = [Math]::Max(1, [int]([double]${Number(widthMm)} / 25.4 * 100))
  $contentW = [Math]::Max(1, [int]([double]${receiptContentWidthMm(widthMm)} / 25.4 * 100))
  $h = [Math]::Max($w, [int]([double]$img.Height / ${THERMAL_DPI} * 100) + 5)
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize 'FotReceipt', $w, $h
  $doc.add_PrintPage({
    param($sender, $e)
    $imgW = [double]$img.Width / [double]$img.HorizontalResolution * 100.0
    $imgH = [double]$img.Height / [double]$img.VerticalResolution * 100.0
    # Thermal drivers frequently report PrintableArea/PageBounds for their
    # default paper (A4) instead of this custom roll size. Trusting those
    # values pushes the receipt far to the right and off the paper, so the
    # roll width we asked for is the only reliable reference here.
    $fit = [Math]::Min(1.0, $contentW / $imgW)
    $drawW = $imgW * $fit
    $drawH = $imgH * $fit
    # Graphics origin is already the first printable dot of the head.
    $x = 0
    $y = 0
    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $e.Graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    $e.Graphics.DrawImage($img, $x, $y, $drawW, $drawH)
    $e.HasMorePages = $false
  })
  for ($i = 0; $i -lt ${Math.max(1, copies)}; $i++) { $doc.Print() }
} finally {
  if ($img -ne $null) { $img.Dispose() }
  if ($source -ne $null) { $source.Dispose() }
}
`;
  await runPowerShell(script);
}

function printCopy(win, options) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('انتهت مهلة الطباعة')), 45_000);
    win.webContents.print(options, (ok, err) => {
      clearTimeout(timer);
      if (!ok) reject(new Error(err || 'رفض تعريف الطابعة المهمة'));
      else resolve();
    });
  });
}

async function printHtmlChromium(html, copies, deviceName, widthMm) {
  // Chromium's print pipeline treats CSS px as 1/96 inch, so the 203-dpi
  // layout must be converted back before handing it to the driver.
  const cssHtml = html.replace(/<style>([\s\S]*?)<\/style>/i, (_block, css) => {
    const scaled = css.replace(/(-?\d+(?:\.\d+)?)px/g, (_m, value) =>
      `${Math.round((Number(value) * 96 / THERMAL_DPI) * 1000) / 1000}px`);
    return `<style>${scaled}</style>`;
  });
  const contentPx = Math.round(receiptContentWidthMm(widthMm) / 25.4 * 96);
  await withReceiptWindow(cssHtml, contentPx, { offscreen: false, show: true, x: -4800, y: -4800 }, async (win, size) => {
    const heightMm = Math.max(120, Math.ceil(size.height / 96 * 25.4) + 8);
    const options = {
      silent: true,
      printBackground: true,
      deviceName: deviceName || undefined,
      color: false,
      landscape: false,
      scaleFactor: 100,
      margins: { marginType: 'none' },
      dpi: { horizontal: THERMAL_DPI, vertical: THERMAL_DPI },
      pageSize: {
        width: Math.round(widthMm * MICRONS_PER_MM),
        height: Math.round(heightMm * MICRONS_PER_MM),
      },
    };
    for (let i = 0; i < copies; i++) {
      try {
        await printCopy(win, options);
      } catch {
        await printCopy(win, {
          silent: true,
          printBackground: true,
          deviceName: deviceName || undefined,
          margins: { marginType: 'none' },
        });
      }
    }
  });
}

function clampMm(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function labelSizeMm(options) {
  return {
    widthMm: clampMm(options?.paperWidthMm, 50, 20, 280),
    heightMm: clampMm(options?.paperHeightMm, 30, 15, 240),
  };
}

function labelPx(mm) {
  return Math.max(1, Math.round(Number(mm) / 25.4 * THERMAL_DPI));
}

async function withLabelWindow(html, widthPx, heightPx, prefs, fn) {
  const htmlPath = path.join(os.tmpdir(), `fot-lbl-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  const win = new BrowserWindow({
    show: Boolean(prefs.show),
    x: prefs.x,
    y: prefs.y,
    width: widthPx,
    height: heightPx,
    useContentSize: true,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
      backgroundThrottling: false,
      offscreen: Boolean(prefs.offscreen),
      zoomFactor: 1,
    },
  });
  try {
    win.webContents.setZoomFactor(1);
    await win.loadFile(htmlPath);
    await win.webContents.executeJavaScript(`
      Promise.all([
        document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve(),
        ...Array.from(document.images).map(img => img.complete
          ? Promise.resolve()
          : new Promise(done => {
              img.addEventListener('load', done, { once: true });
              img.addEventListener('error', done, { once: true });
              setTimeout(done, 1500);
            })),
      ]).then(() => 1)
    `, true);
    win.setContentSize(widthPx, heightPx);
    await sleep(200);
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try { fs.unlinkSync(htmlPath); } catch { /* ignore */ }
  }
}

async function captureLabelPng(html, widthMm, heightMm) {
  const widthPx = labelPx(widthMm);
  const heightPx = labelPx(heightMm);
  const tryCapture = async prefs => withLabelWindow(html, widthPx, heightPx, prefs, async win => {
    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: widthPx,
      height: heightPx,
    });
    const px = image?.getSize?.() || { width: 0, height: 0 };
    if (!image || image.isEmpty() || px.width < 40 || px.height < 30) {
      throw new Error('empty capture');
    }
    const pngPath = path.join(os.tmpdir(), `fot-lbl-${Date.now()}.png`);
    fs.writeFileSync(pngPath, image.toPNG());
    return pngPath;
  });

  try {
    return await tryCapture({ offscreen: true, show: false });
  } catch {
    return tryCapture({ offscreen: false, show: true, x: -4800, y: -4800 });
  }
}

async function printPngGdiLabel(pngPath, printerName, copies, widthMm, heightMm) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile(${psQuote(pngPath)})
$img = $null
try {
  $img = [System.Drawing.Bitmap]::new(
    $source.Width, $source.Height,
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  )
  $img.SetResolution(${THERMAL_DPI}, ${THERMAL_DPI})
  $raster = [System.Drawing.Graphics]::FromImage($img)
  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  try {
    $raster.Clear([System.Drawing.Color]::White)
    $raster.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $raster.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $attrs.SetThreshold(0.52)
    $dest = [System.Drawing.Rectangle]::new(0, 0, $source.Width, $source.Height)
    $raster.DrawImage(
      $source, $dest, 0, 0, $source.Width, $source.Height,
      [System.Drawing.GraphicsUnit]::Pixel, $attrs
    )
  } finally {
    $attrs.Dispose()
    $raster.Dispose()
    $source.Dispose()
    $source = $null
  }
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.DocumentName = 'FOT POS Label'
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  ${printerName ? `$doc.PrinterSettings.PrinterName = ${psQuote(printerName)}` : ''}
  if (-not $doc.PrinterSettings.IsValid) { throw 'تعريف الطابعة غير صالح' }
  $doc.OriginAtMargins = $false
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins 0,0,0,0
  $w = [Math]::Max(1, [int]([double]${Number(widthMm)} / 25.4 * 100))
  $h = [Math]::Max(1, [int]([double]${Number(heightMm)} / 25.4 * 100))
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize 'FotLabel', $w, $h
  $doc.add_PrintPage({
    param($sender, $e)
    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $e.Graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    $e.Graphics.DrawImage($img, 0, 0, $w, $h)
    $e.HasMorePages = $false
  })
  for ($i = 0; $i -lt ${Math.max(1, copies)}; $i++) { $doc.Print() }
} finally {
  if ($img -ne $null) { $img.Dispose() }
  if ($source -ne $null) { $source.Dispose() }
}
`;
  await runPowerShell(script);
}

async function printLabelChromium(html, copies, deviceName, widthMm, heightMm) {
  const cssHtml = html.replace(/<style>([\s\S]*?)<\/style>/i, (_block, css) => {
    const scaled = css.replace(/(-?\d+(?:\.\d+)?)px/g, (_m, value) =>
      `${Math.round((Number(value) * 96 / THERMAL_DPI) * 1000) / 1000}px`);
    return `<style>${scaled}</style>`;
  });
  const widthPx = Math.round(Number(widthMm) / 25.4 * 96);
  const heightPx = Math.round(Number(heightMm) / 25.4 * 96);
  await withLabelWindow(cssHtml, widthPx, heightPx, { offscreen: false, show: true, x: -4800, y: -4800 }, async win => {
    const options = {
      silent: true,
      printBackground: true,
      deviceName: deviceName || undefined,
      color: false,
      landscape: false,
      scaleFactor: 100,
      margins: { marginType: 'none' },
      dpi: { horizontal: THERMAL_DPI, vertical: THERMAL_DPI },
      pageSize: {
        width: Math.round(widthMm * MICRONS_PER_MM),
        height: Math.round(heightMm * MICRONS_PER_MM),
      },
    };
    for (let i = 0; i < copies; i++) {
      try {
        await printCopy(win, options);
      } catch {
        await printCopy(win, {
          silent: true,
          printBackground: true,
          deviceName: deviceName || undefined,
          margins: { marginType: 'none' },
        });
      }
    }
  });
}

async function printLabelJob(html, copies, deviceName, options) {
  const { widthMm, heightMm } = labelSizeMm(options);
  const n = Math.max(1, Number(copies) || 1);
  const named = deviceName || undefined;
  let pngPath;
  try {
    pngPath = await captureLabelPng(html, widthMm, heightMm);
    await printPngGdiLabel(pngPath, named, n, widthMm, heightMm);
    return { ok: true };
  } catch (gdiErr) {
    try {
      await printLabelChromium(html, n, named, widthMm, heightMm);
      return { ok: true };
    } catch (e) {
      const first = gdiErr instanceof Error ? gdiErr.message : String(gdiErr);
      const second = e instanceof Error ? e.message : String(e);
      return { ok: false, message: second || first };
    }
  } finally {
    if (pngPath) {
      try { fs.unlinkSync(pngPath); } catch { /* ignore */ }
    }
  }
}

async function printHtml(html, copies = 1, deviceName, options) {
  if (!html || !String(html).includes('<')) {
    return { ok: false, message: options?.kind === 'label' ? 'لا يوجد ملصق للطباعة' : 'لا توجد فاتورة للطباعة' };
  }
  if (options?.kind === 'label') {
    return printLabelJob(html, copies, deviceName, options);
  }
  const widthMm = Number(options?.paperWidthMm) === 58 ? 58 : 80;
  const n = Math.max(1, Number(copies) || 1);
  const named = deviceName || undefined;

  let pngPath;
  try {
    pngPath = await captureReceiptPng(html, widthMm);
    await printPngGdi(pngPath, named, n, widthMm);
    return { ok: true };
  } catch (gdiErr) {
    try {
      await printHtmlChromium(html, n, named, widthMm);
      return { ok: true };
    } catch (e) {
      const first = gdiErr instanceof Error ? gdiErr.message : String(gdiErr);
      const second = e instanceof Error ? e.message : String(e);
      return { ok: false, message: second || first };
    }
  } finally {
    if (pngPath) {
      try { fs.unlinkSync(pngPath); } catch { /* ignore */ }
    }
  }
}

module.exports = { printHtml };
