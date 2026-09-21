const fs = require('fs');
const path = require('path');

function configPath(userDataDir) {
  return path.join(userDataDir, 'window-config.json');
}

function readWindowConfig(userDataDir, defaults = { fullscreen: true }) {
  try {
    const raw = fs.readFileSync(configPath(userDataDir), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      fullscreen: parsed.fullscreen == null ? defaults.fullscreen : Boolean(parsed.fullscreen),
    };
  } catch {
    return { fullscreen: defaults.fullscreen };
  }
}

function writeWindowConfig(userDataDir, patch, defaults = { fullscreen: true }) {
  const current = readWindowConfig(userDataDir, defaults);
  const next = {
    fullscreen: patch.fullscreen === undefined ? current.fullscreen : Boolean(patch.fullscreen),
  };
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { readWindowConfig, writeWindowConfig };
