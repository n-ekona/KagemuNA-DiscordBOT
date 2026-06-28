import { Client, Collection, GatewayIntentBits } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config, assertConfig } from '../config.js';
import { logger } from './logger.js';
import { initDb, closeAllOpenSessions, closeDb } from './db.js';
import { stopHeartbeat } from './tracking.js';
import { stopPresence } from './presence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadCommands(client) {
  client.commands = new Collection();
  const dir = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const cmd = mod.default;
    if (cmd?.data?.name && typeof cmd.execute === 'function') {
      client.commands.set(cmd.data.name, cmd);
    } else {
      logger.warn(`Skipping command file "${file}": missing data/execute export.`);
    }
  }
  logger.info(`Loaded ${client.commands.size} command(s).`);
}

async function loadEvents(client) {
  const dir = path.join(__dirname, 'events');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const evt = mod.default;
    if (!evt?.name || typeof evt.execute !== 'function') {
      logger.warn(`Skipping event file "${file}": missing name/execute export.`);
      continue;
    }
    if (evt.once) client.once(evt.name, (...args) => evt.execute(...args));
    else client.on(evt.name, (...args) => evt.execute(...args));
  }
}

async function main() {
  assertConfig();
  initDb();

  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ];
  // Both the forum AI summary (reads thread content) and the shiritori game
  // (reads each word) need the privileged MessageContent intent. Request it when
  // either is configured (and enable the matching toggle in the Developer Portal).
  if (config.geminiApiKey || config.shiritoriChannelId) {
    intents.push(GatewayIntentBits.MessageContent);
    logger.info('Forum AI / shiritori enabled -> requesting MessageContent intent (must be enabled in the Dev Portal).');
  }
  const client = new Client({ intents });

  await loadCommands(client);
  await loadEvents(client);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down...`);
    try {
      stopHeartbeat();
      stopPresence();
      // Stop the gateway first so no further voice/message events arrive...
      await client.destroy();
      // ...then record VC time up to this moment for everyone still connected.
      closeAllOpenSessions(Date.now());
      closeDb();
    } catch (err) {
      logger.error('Error during shutdown:', err);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Stay alive through transient promise rejections (common with network blips),
  // but bail on a corrupt process state so systemd can restart us cleanly.
  process.on('unhandledRejection', (err) => logger.error('Unhandled promise rejection:', err));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    process.exit(1);
  });

  // Fail fast if the gateway never connects (e.g. a DNS/network hang on a Pi) so
  // systemd's Restart=on-failure can take over instead of hanging indefinitely.
  let loginTimer;
  const loginTimeout = new Promise((_, reject) => {
    loginTimer = setTimeout(() => reject(new Error('Discord login timed out after 45s')), 45_000);
  });
  try {
    await Promise.race([client.login(config.token), loginTimeout]);
  } finally {
    clearTimeout(loginTimer);
  }
}

main().catch((err) => {
  logger.error('Fatal startup error:', err);
  if (/disallowed intents/i.test(String(err?.message)) || String(err?.code).includes('DisallowedIntents')) {
    logger.error(
      'ヒント: GEMINI_API_KEY を設定した場合は、Discord Developer Portal の Bot 設定で ' +
        '「Message Content Intent」を有効化してください（有効化前は起動できません）。'
    );
  }
  process.exit(1);
});
