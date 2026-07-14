const fs = require('fs');
const path = require('path');
const config = require('./config');
const settings = require('./settings');
const logger = require('./logger');

class BackgroundsManager {
  fetchRandom() {
    try {
      if (!fs.existsSync(config.BACKGROUNDS_DIR)) {
        return { error: 'backgrounds directory not found' };
      }
      const files = fs.readdirSync(config.BACKGROUNDS_DIR)
        .filter(f => config.IMAGE_EXTS.includes(path.extname(f).toLowerCase()));
      if (files.length === 0) {
        return { error: 'no images in backgrounds folder' };
      }

      const enabledBgMap = settings.get('enabledBackgrounds', {});
      const pool = files.filter(f => enabledBgMap[f] !== false);
      if (pool.length === 0) {
        return { error: 'no enabled backgrounds' };
      }

      const file = path.join(config.BACKGROUNDS_DIR, pool[Math.floor(Math.random() * pool.length)]);
      const data = fs.readFileSync(file);
      const ext = path.extname(file).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      logger.debug('Background: loaded', path.basename(file));
      return { dataUrl: `data:${mime};base64,${data.toString('base64')}` };
    } catch (err) {
      logger.error('Background fetch failed:', err.message);
      return { error: err.message };
    }
  }

  list() {
    try {
      if (!fs.existsSync(config.BACKGROUNDS_DIR)) {
        return { backgrounds: [] };
      }
      const files = fs.readdirSync(config.BACKGROUNDS_DIR)
        .filter(f => config.IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
        .sort();

      const enabledBgMap = settings.get('enabledBackgrounds', {});
      return {
        backgrounds: files.map(name => ({
          name,
          enabled: enabledBgMap[name] !== false
        }))
      };
    } catch (err) {
      logger.error('Background list failed:', err.message);
      return { error: err.message, backgrounds: [] };
    }
  }

  toggle(name, enabled) {
    try {
      const enabledBgMap = settings.get('enabledBackgrounds', {});
      enabledBgMap[name] = enabled;
      settings.set('enabledBackgrounds', enabledBgMap);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  getFile(filename) {
    try {
      const filePath = path.join(config.BACKGROUNDS_DIR, filename);
      if (!fs.existsSync(filePath)) return { error: 'file not found' };
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const data = fs.readFileSync(filePath);
      return { dataUrl: `data:${mime};base64,${data.toString('base64')}` };
    } catch (err) {
      return { error: err.message };
    }
  }

  importFile(srcPath) {
    const ext = path.extname(srcPath).toLowerCase();
    if (!config.IMAGE_EXTS.includes(ext)) {
      return { error: 'Unsupported image format' };
    }

    const baseName = path.basename(srcPath);
    let name = baseName;
    let destPath = path.join(config.BACKGROUNDS_DIR, name);
    let counter = 1;
    while (fs.existsSync(destPath)) {
      const parsed = path.parse(baseName);
      name = `${parsed.name}_${counter}${parsed.ext}`;
      destPath = path.join(config.BACKGROUNDS_DIR, name);
      counter++;
    }

    try {
      fs.mkdirSync(config.BACKGROUNDS_DIR, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      logger.info('Background imported:', name);
      return { success: true, name };
    } catch (err) {
      return { error: err.message };
    }
  }
}

module.exports = new BackgroundsManager();
