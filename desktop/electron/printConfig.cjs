const fs = require('fs');
const path = require('path');

function configPath(userDataDir) {
  return path.join(userDataDir, 'print-config.json');
}

/**
 * طابعات هذا الجهاز: printerName = الطابعة الحرارية للإيصالات، labelPrinterName = طابعة الملصقات
 * (ملصقات شركة التوصيل والباركود — print:raster يستعملها افتراضياً).
 */
function readPrintConfig(userDataDir) {
  try {
    const raw = fs.readFileSync(configPath(userDataDir), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      printerName: parsed.printerName ?? null,
      askBeforePrint: Boolean(parsed.askBeforePrint),
      labelPrinterName: parsed.labelPrinterName ?? null,
    };
  } catch {
    return { printerName: null, askBeforePrint: false, labelPrinterName: null };
  }
}

function writePrintConfig(userDataDir, patch) {
  const current = readPrintConfig(userDataDir);
  const next = {
    printerName: patch.printerName === undefined ? current.printerName : patch.printerName,
    askBeforePrint: patch.askBeforePrint === undefined ? current.askBeforePrint : Boolean(patch.askBeforePrint),
    labelPrinterName: patch.labelPrinterName === undefined ? current.labelPrinterName : patch.labelPrinterName,
  };
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { readPrintConfig, writePrintConfig };
