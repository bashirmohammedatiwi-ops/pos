const fs = require('fs');
const path = require('path');

let logDir = null;

function configure(userData) {
  logDir = path.join(userData, 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function logFilePath() {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(logDir || process.cwd(), `fot-pos-${day}.log`);
}

function write(level, message, detail) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}${detail ? ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}\n`;
  try {
    fs.appendFileSync(logFilePath(), line, 'utf8');
  } catch {
    /* ignore disk errors */
  }
  if (level === 'ERROR') console.error(line.trim());
  else console.log(line.trim());
}

function logError(message, detail) {
  write('ERROR', message, detail);
}

function logInfo(message, detail) {
  write('INFO', message, detail);
}

module.exports = { configure, logError, logInfo, logFilePath };
