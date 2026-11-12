const fs = require('fs');
const path = require('path');

function isPackaged() {
  try {
    const { app } = require('electron');
    if (app && typeof app.isPackaged === 'boolean') return app.isPackaged;
  } catch {
    /* preload sandbox still has electron */
  }
  return Boolean(process.resourcesPath) && process.defaultApp !== true;
}

/** pos = الكاشير، orders = «كاشير الطلبات» (نفس واجهة الكاشير على شاشة الطلبات)، admin = لوحة التحكم. */
function resolveRole() {
  if (process.argv.includes('--orders') || process.env.FOT_APP === 'orders') return 'orders';
  if (process.argv.includes('--pos') || process.env.FOT_APP === 'pos') return 'pos';
  if (process.argv.includes('--admin') || process.env.FOT_APP === 'admin') return 'admin';

  const file = isPackaged()
    ? path.join(process.resourcesPath, 'fot-role.txt')
    : path.join(__dirname, 'fot-role.txt');
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (value === 'pos' || value === 'orders' || value === 'admin') return value;
  } catch {
    /* unpackaged default */
  }
  return 'admin';
}

/** الكاشير و«كاشير الطلبات» يتصرفان كتطبيق نقطة بيع (نافذة ملء الشاشة، دخول جديد كل تشغيل، واجهة fot-pos). */
function isPosLikeRole(role) {
  return role === 'pos' || role === 'orders';
}

module.exports = { resolveRole, isPosLikeRole };
