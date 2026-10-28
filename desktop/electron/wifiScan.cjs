/*
 * البحث عن شبكات الواي فاي من جهاز لوحة التحكم نفسه (بصلاحيات المستخدم).
 * احتياط لبحث سيرفر المحل: الخدمة تعمل كـ LocalSystem وقد يمنعها ويندوز من قراءة الواي فاي.
 * التحليل لا يعتمد على لغة ويندوز: SSID و BSSID لا تُترجمان، والباقي يُعرف من شكل القيمة.
 */
const { execFile } = require('child_process');

function runNetsh(args) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ out: '', code: -1 });
    // chcp 65001: أسماء الشبكات العربية بترميز UTF-8
    execFile('cmd.exe', ['/d', '/c', `chcp 65001 >nul & netsh ${args}`], { windowsHide: true, timeout: 15000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ out: `${stdout || ''}${stderr || ''}`, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
    });
  });
}


// يطلب من ويندوز بحثاً جديداً (WlanScan): netsh وحده يعرض آخر قائمة محفوظة وقد تكون ناقصة
const WLAN_SCAN_PS = "# يطلب من ويندوز بحثاً جديداً عن شبكات الواي فاي (WlanScan) ثم ينتظر النتائج.\n# netsh وحده يعرض آخر قائمة محفوظة فقط، وقد تكون قديمة أو ناقصة.\n$ErrorActionPreference = 'SilentlyContinue'\nAdd-Type -TypeDefinition @\"\nusing System;\nusing System.Runtime.InteropServices;\npublic static class FotWlan {\n  [DllImport(\"wlanapi.dll\")] static extern int WlanOpenHandle(uint v, IntPtr r, out uint neg, out IntPtr h);\n  [DllImport(\"wlanapi.dll\")] static extern int WlanEnumInterfaces(IntPtr h, IntPtr r, out IntPtr list);\n  [DllImport(\"wlanapi.dll\")] static extern int WlanScan(IntPtr h, ref Guid g, IntPtr ssid, IntPtr ie, IntPtr r);\n  [DllImport(\"wlanapi.dll\")] static extern void WlanFreeMemory(IntPtr p);\n  [DllImport(\"wlanapi.dll\")] static extern int WlanCloseHandle(IntPtr h, IntPtr r);\n  public static int Scan() {\n    uint neg; IntPtr h;\n    if (WlanOpenHandle(2, IntPtr.Zero, out neg, out h) != 0) return -1;\n    int n = 0;\n    try {\n      IntPtr list;\n      if (WlanEnumInterfaces(h, IntPtr.Zero, out list) != 0) return -2;\n      int count = Marshal.ReadInt32(list);\n      for (int i = 0; i < count; i++) {\n        // WLAN_INTERFACE_INFO = GUID(16) + WCHAR[256](512) + state(4) = 532 bytes, after 8-byte header\n        byte[] g = new byte[16];\n        Marshal.Copy(new IntPtr(list.ToInt64() + 8 + i * 532), g, 0, 16);\n        Guid id = new Guid(g);\n        if (WlanScan(h, ref id, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero) == 0) n++;\n      }\n      WlanFreeMemory(list);\n    } finally { WlanCloseHandle(h, IntPtr.Zero); }\n    return n;\n  }\n}\n\"@\n$n = [FotWlan]::Scan()\nif ($n -gt 0) { Start-Sleep -Seconds 4 }\nWrite-Output \"scanned=$n\"\n";

function triggerScan() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(false);
    const encoded = Buffer.from(WLAN_SCAN_PS, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      resolve(!err && /scanned=[1-9]/.test(String(stdout)));
    });
  });
}

const MAC = /([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i;

function parseNetworks(text) {
  const list = [];
  let net = null;
  let ap = null;
  let fieldIndex = 0;
  const flush = () => {
    if (net && ap) net.accessPoints.push(ap);
    ap = null;
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const ssid = raw.match(/^\s*SSID\s+\d+\s*:\s*(.*)$/);
    if (ssid) {
      flush();
      net = { ssid: ssid[1].trim(), auth: null, accessPoints: [] };
      list.push(net);
      fieldIndex = 0;
      continue;
    }
    const bssid = raw.match(/^\s*BSSID\s+\d+\s*:\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i);
    if (bssid) {
      flush();
      ap = { bssid: bssid[1].toLowerCase(), signal: null, channel: null, band: null };
      continue;
    }
    const f = raw.match(/^\s*[^:]+?\s*:\s*(.+?)\s*$/);
    if (!f || !net) continue;
    const value = f[1];
    if (!ap) {
      // بعد SSID: نوع الشبكة ثم المصادقة
      fieldIndex++;
      if (fieldIndex === 2) net.auth = value;
      continue;
    }
    if (ap.signal == null && /^\d{1,3}\s*%$/.test(value)) ap.signal = parseInt(value, 10);
    else if (ap.band == null && /GHz/i.test(value)) ap.band = value;
    else if (ap.channel == null && /^\d{1,3}$/.test(value)) ap.channel = parseInt(value, 10);
  }
  flush();
  return list
    .filter(n => n.accessPoints.length)
    .map(n => ({ ...n, accessPoints: n.accessPoints.sort((a, b) => (b.signal ?? 0) - (a.signal ?? 0)) }))
    .sort((a, b) => Math.max(...b.accessPoints.map(x => x.signal ?? 0)) - Math.max(...a.accessPoints.map(x => x.signal ?? 0)));
}

function parseInterface(text) {
  let ssid = null;
  let bssid = null;
  let signal = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const b = raw.match(/BSSID\s*:\s*/i) && raw.match(MAC);
    if (b) {
      bssid = bssid || b[1].toLowerCase();
      continue;
    }
    const s = raw.match(/^\s*SSID\s*:\s*(.*)$/);
    if (s) {
      ssid = ssid ?? s[1].trim();
      continue;
    }
    const f = raw.match(/^\s*[^:]+?\s*:\s*(.+?)\s*$/);
    if (f && signal == null && bssid && /^\d{1,3}\s*%$/.test(f[1])) signal = parseInt(f[1], 10);
  }
  return bssid ? { ssid, bssid, signal } : null;
}

async function scanWifi() {
  await triggerScan();
  const [nets, iface] = await Promise.all([runNetsh('wlan show networks mode=bssid'), runNetsh('wlan show interfaces')]);
  const networks = parseNetworks(nets.out);
  const current = parseInterface(iface.out);
  if (networks.length) return { networks, current, error: null, source: 'local' };
  const lower = nets.out.toLowerCase();
  const error =
    lower.includes('location') || lower.includes('الموقع')
      ? 'ويندوز يمنع قراءة شبكات الواي فاي — فعّل «الموقع» من الإعدادات ← الخصوصية والأمان ← الموقع، واسمح للتطبيقات المكتبية بالوصول إليه'
      : nets.code !== 0 || lower.includes('wlansvc') || lower.includes('no wireless interface')
        ? 'هذا الجهاز لا يحتوي بطاقة واي فاي (أو أنها متوقفة)'
        : 'لم تُعثر على شبكات — تأكد أن الواي فاي مفعّل على هذا الجهاز';
  return { networks, current, error, source: 'local' };
}

module.exports = { scanWifi, parseNetworks, parseInterface };
