const fs = require('fs');
const path = require('path');

let userData = null;

function configure(dir) {
  userData = dir;
}

function configPath() {
  return userData ? path.join(userData, 'api-base.json') : null;
}

function normalizeApiBase(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim().replace(/\/$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '5000');
    return `${parsed.protocol}//${parsed.hostname}:${port}`;
  } catch {
    return null;
  }
}

function readSavedApiBase() {
  try {
    const p = configPath();
    if (!p || !fs.existsSync(p)) return null;
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return normalizeApiBase(json.url);
  } catch {
    return null;
  }
}

function writeSavedApiBase(url) {
  const normalized = normalizeApiBase(url);
  const p = configPath();
  if (!p || !normalized) return normalized;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ url: normalized, savedAt: new Date().toISOString() }, null, 2));
  return normalized;
}

module.exports = { configure, normalizeApiBase, readSavedApiBase, writeSavedApiBase };
