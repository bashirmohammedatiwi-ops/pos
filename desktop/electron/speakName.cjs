const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** @type {ReturnType<typeof startPiper> | null} */
let piper = null;
/** @type {import('child_process').ChildProcess | null} */
let player = null;
/** @type {Promise<void>} */
let synthChain = Promise.resolve();
let cacheDir = '';

function resolveTtsDir() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'tts'));
  candidates.push(path.join(__dirname, '..', 'tts'));
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'piper.exe')) && fs.existsSync(path.join(dir, 'libtashkeel_model.ort'))) {
      return dir;
    }
  }
  return null;
}

function sanitizeSpokenName(raw) {
  let name = String(raw ?? '').replace(/\uFFFD/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!name) return '';
  name = name.replace(/^\s*[#٪%]?\s*[\d\u0660-\u0669\u06F0-\u06F9]+\s*[-–—.:،\/\\|]+\s*/u, '');
  name = name.replace(/^\s*[\d\u0660-\u0669\u06F0-\u06F9]+\s+/u, '');
  name = name.replace(/[\d\u0660-\u0669\u06F0-\u06F9]+/gu, '');
  name = name.replace(/[#٪%]/gu, '');
  name = name.replace(/\s{2,}/g, ' ').trim();
  name = name.replace(/^[-–—.:،\/\\|]+|[-–—.:،\/\\|]+$/g, '').trim();
  return name;
}

/** Pause between name parts so each word is pronounced on its own. */
function phraseForSpeech(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
  return parts.join('، ');
}

function cacheFile(text) {
  const key = crypto.createHash('sha1').update(text).digest('hex');
  return path.join(cacheDir, `${key}.wav`);
}

function startPlayer() {
  if (player && !player.killed) return player;
  const script = [
    '$ErrorActionPreference = "Continue"',
    'while ($null -ne ($line = [Console]::In.ReadLine())) {',
    '  $line = $line.Trim()',
    '  if ($line.Length -eq 0 -or -not (Test-Path -LiteralPath $line)) { continue }',
    '  try {',
    '    $p = New-Object System.Media.SoundPlayer $line',
    '    $p.PlaySync()',
    '  } catch {}',
    '}',
  ].join('; ');
  player = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] },
  );
  player.on('exit', () => { player = null; });
  return player;
}

function startPiper(dir) {
  const proc = spawn(
    path.join(dir, 'piper.exe'),
    [
      '--model', path.join(dir, 'ar_JO-kareem-medium.onnx'),
      '--tashkeel_model', path.join(dir, 'libtashkeel_model.ort'),
      '--output_file', '-',
      '--quiet',
      '--length_scale', '1.12',
      '--noise_scale', '0.33',
      '--noise_w', '0.55',
      '--sentence_silence', '0.08',
    ],
    { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );

  let buf = Buffer.alloc(0);
  /** @type {((wav: Buffer) => void) | null} */
  let waiter = null;

  const pump = () => {
    if (!waiter || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return;
    const size = buf.readUInt32LE(4) + 8;
    if (size < 44 || size > 12_000_000 || buf.length < size) return;
    const wav = Buffer.from(buf.subarray(0, size));
    buf = buf.subarray(size);
    const done = waiter;
    waiter = null;
    done(wav);
  };

  proc.stdout.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    pump();
  });
  proc.on('exit', () => {
    if (piper && piper.proc === proc) piper = null;
  });

  return {
    proc,
    write(text) {
      proc.stdin.write(Buffer.from(`${text.replace(/[\r\n]+/g, ' ')}\n`, 'utf8'));
    },
    nextWav() {
      return new Promise(resolve => {
        waiter = resolve;
        pump();
      });
    },
  };
}

function ensureEngine() {
  if (!cacheDir) return null;
  const dir = resolveTtsDir();
  if (!dir) return null;
  if (!piper || piper.proc.killed || piper.proc.exitCode != null) piper = startPiper(dir);
  startPlayer();
  return piper;
}

function synthesize(text) {
  const engine = ensureEngine();
  if (!engine) return Promise.reject(new Error('tts-missing'));
  const pending = engine.nextWav();
  engine.write(text);
  return pending;
}

async function getWav(text) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = cacheFile(text);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;

  const run = synthChain.then(async () => {
    const wav = await synthesize(text);
    if (!wav || wav.length < 1000) throw new Error('empty-audio');
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, wav);
    fs.renameSync(tmp, file);
    return file;
  });
  synthChain = run.then(() => undefined, () => undefined);
  return run;
}

function enqueuePlay(file) {
  const proc = startPlayer();
  if (!proc.stdin.writable) return;
  proc.stdin.write(`${file}\n`);
}

function configureTts(userData) {
  cacheDir = path.join(userData, 'tts-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
}

function warmupTts(userData) {
  if (userData) configureTts(userData);
  if (!resolveTtsDir()) return;
  ensureEngine();
  void getWav('مرحبا').catch(() => undefined);
}

async function speakSalesmanName(rawText) {
  const spoken = phraseForSpeech(sanitizeSpokenName(rawText));
  if (!spoken) return { ok: false, reason: 'empty' };
  if (!resolveTtsDir()) return { ok: false, reason: 'tts-missing' };
  if (!cacheDir) return { ok: false, reason: 'tts-not-ready' };

  try {
    const file = await getWav(spoken);
    enqueuePlay(file);
    return { ok: true, cached: true };
  } catch (err) {
    piper = null;
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function stopSpeaking() {
  if (player && !player.killed) {
    try { player.kill(); } catch { /* ignore */ }
    player = null;
  }
  return { ok: true };
}

module.exports = { speakSalesmanName, stopSpeaking, sanitizeSpokenName, configureTts, warmupTts };
