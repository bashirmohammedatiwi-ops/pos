const { execSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

function readMachineGuid() {
  try {
    const raw = execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', {
      encoding: 'utf8',
      windowsHide: true,
    });
    const match = raw.match(/MachineGuid\s+REG_SZ\s+(.+)/i);
    if (match) return match[1].trim();
  } catch {
    /* ignore */
  }
  return null;
}

function getMachineHwId() {
  const guid = readMachineGuid();
  if (guid) return `win:${guid}`;
  const mac = os.networkInterfaces();
  const first = Object.values(mac)
    .flat()
    .find(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00');
  const seed = `${os.hostname()}|${first?.mac || 'nomac'}`;
  return `host:${crypto.createHash('sha1').update(seed).digest('hex')}`;
}

module.exports = { getMachineHwId };
