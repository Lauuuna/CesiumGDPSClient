const DiscordRPC = require('discord-rpc');
const config = require('./config');
const logger = require('./logger');

class DiscordManager {
  constructor() {
    this._client = null;
    this._retryTimer = null;
    this._destroyed = false;
    this._startTimestamp = new Date();
    this._currentActivity = { state: 'Idle', details: 'CesiumGDPS' };

    try { DiscordRPC.register(config.DISCORD_CLIENT_ID); } catch {}
  }

  setActivity(activity) {
    this._currentActivity = { ...this._currentActivity, ...activity };
    if (this._client) {
      this._client.setActivity({
        details: this._currentActivity.details,
        state: this._currentActivity.state,
        startTimestamp: this._startTimestamp,
        buttons: config.DISCORD_BUTTONS,
      }).catch(() => {});
    }
  }

  connect() {
    if (this._destroyed) return;
    this._disconnect();

    const client = new DiscordRPC.Client({ transport: 'ipc' });

    client.on('ready', () => {
      logger.info('Discord RPC connected');
      this._client = client;
      this.setActivity({});
    });

    client.on('disconnected', () => {
      logger.debug('Discord RPC disconnected');
      if (this._client === client) this._client = null;
    });

    client.login({ clientId: config.DISCORD_CLIENT_ID }).catch((err) => {
      logger.warn('Discord RPC login failed:', err.message);
      if (this._client === client) this._client = null;
      try { client.destroy(); } catch {}
      if (!this._destroyed) {
        this._retryTimer = setTimeout(() => this.connect(), 15000);
      }
    });
  }

  _disconnect() {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this._client) {
      try { this._client.destroy(); } catch {}
      this._client = null;
    }
  }

  destroy() {
    this._destroyed = true;
    this._disconnect();
  }
}

module.exports = new DiscordManager();
