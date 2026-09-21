const fs = require('fs');
const path = require('path');
const { session } = require('electron');

const MARKER = 'session-dirty';
// Only graphics-related caches get wiped on a dirty shutdown. The code caches
// ('Cache', 'CachedData', 'Code Cache') hold the compiled renderer bundle — wiping
// them after every crash made the next launch start with a long blank window.
const CACHE_DIRS = [
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
];

function markerPath(userData) {
  return path.join(userData, MARKER);
}

function wasDirtyShutdown(userData) {
  try {
    return fs.existsSync(markerPath(userData));
  } catch {
    return false;
  }
}

function markRunning(userData) {
  try {
    fs.writeFileSync(markerPath(userData), String(Date.now()), 'utf8');
  } catch {
    /* ignore */
  }
}

function markClean(userData) {
  try {
    fs.unlinkSync(markerPath(userData));
  } catch {
    /* ignore */
  }
}

function wipeCacheDirs(userData) {
  for (const name of CACHE_DIRS) {
    try {
      fs.rmSync(path.join(userData, name), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function clearChromiumCaches() {
  try {
    const ses = session.defaultSession;
    // Keep code caches intact — they are what makes repeat launches fast.
    await ses.clearStorageData({
      storages: ['shadercache', 'serviceworkers', 'cachestorage'],
    });
  } catch {
    /* ignore */
  }
}

module.exports = {
  wasDirtyShutdown,
  markRunning,
  markClean,
  wipeCacheDirs,
  clearChromiumCaches,
};
