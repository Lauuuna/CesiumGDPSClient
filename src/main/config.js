const path = require('path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..', '..');

const config = {
  ROOT,
  BASE_URL: 'https://lauuuna.github.io/CesiumGDPS/CesiumGDPS/',
  MANIFEST_URL: 'https://lauuuna.github.io/CesiumGDPS/CesiumGDPS/manifest.json',
  CONCURRENCY: 8,
  EXCLUDED_PATHS: ['geode/unzipped/'],
  CHECK_PERCENT: 30,
  DOWNLOAD_PERCENT: 70,
  DISCORD_CLIENT_ID: '1526608832116297759',
  DISCORD_BUTTONS: [
    { label: 'Discord', url: 'https://discord.gg/jd6EAGpaVg' }
  ],
  UPDATE_CACHE_TTL: 300000,
  IMAGE_EXTS: ['.jpg', '.jpeg', '.png', '.webp'],
  DEFAULT_INSTALL_PATH: 'C:\\Games\\CesiumGD',
  BUILD_ICON: path.join(ROOT, 'build', 'icon.png'),
  PRELOAD_PATH: path.join(ROOT, 'preload.js'),
  DASHBOARD_PRELOAD_PATH: path.join(ROOT, 'src', 'dashboard-preload.js'),
  INDEX_HTML: path.join(ROOT, 'src', 'index.html'),
  BACKGROUNDS_DIR: path.join(ROOT, 'src', 'backgrounds'),
};

function userDataPath(sub) {
  return path.join(app.getPath('userData'), sub);
}

module.exports = new Proxy(config, {
  get(target, prop) {
    if (prop === 'SETTINGS_PATH') return userDataPath('settings.json');
    if (prop === 'LOG_DIR') return userDataPath('logs');
    if (prop === 'SESSION_PATH') return userDataPath('download-session.json');
    if (prop === 'STATS_PATH') return userDataPath('game-stats.json');
    return target[prop];
  }
});
