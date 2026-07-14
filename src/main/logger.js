const fs = require('fs');
const path = require('path');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const MAX_LOG_SIZE = 5 * 1024 * 1024;

class Logger {
  constructor() {
    this._level = 'info';
    this._stream = null;
    this._logDir = null;
    this._pending = [];
  }

  setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) this._level = level;
  }

  init(logDir) {
    this._logDir = logDir;
    try {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logFile = path.join(logDir, 'app.log');
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_SIZE) {
        fs.renameSync(logFile, logFile + '.' + Date.now());
      }
      this._stream = fs.createWriteStream(logFile, { flags: 'a' });
      this._stream.on('error', () => {});
      for (const entry of this._pending) {
        this._stream.write(entry + '\n');
      }
      this._pending = [];
    } catch {
      this._stream = null;
    }
  }

  _write(level, ...args) {
    if (LOG_LEVELS[level] < LOG_LEVELS[this._level]) return;
    const timestamp = new Date().toISOString();
    const message = args.map(a =>
      typeof a === 'object' ? (a instanceof Error ? a.stack : JSON.stringify(a)) : String(a)
    ).join(' ');
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    const color = LOG_COLORS[level] || '';
    console.log(`${color}${line}\x1b[0m`);

    if (this._stream) {
      this._stream.write(line + '\n');
    } else if (this._logDir === null) {
      this._pending.push(line);
    }
  }

  debug(...args) { this._write('debug', ...args); }
  info(...args) { this._write('info', ...args); }
  warn(...args) { this._write('warn', ...args); }
  error(...args) { this._write('error', ...args); }

  destroy() {
    if (this._stream) {
      this._stream.end();
    }
  }
}

module.exports = new Logger();
