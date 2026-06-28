import { REST, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config, assertConfig } from '../config.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function collectCommands() {
  const commands = [];
  const dir = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    if (mod.default?.data) {
      // A command may pin itself to a single guild via `guildId` (server-scoped).
      commands.push({ json: mod.default.data.toJSON(), guildId: mod.default.guildId || null });
    } else {
      logger.warn(`Skipping command file "${file}": missing data export.`);
    }
  }
  return commands;
}

async function putGuild(rest, guildId, jsons) {
  try {
    const data = await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: jsons });
    logger.info(`Registered ${data.length} command(s) to guild ${guildId} (instant).`);
  } catch (err) {
    logger.error(`Failed to register to guild ${guildId}: ${err?.message ?? err}`);
  }
}

async function main() {
  assertConfig();
  const all = await collectCommands();
  const rest = new REST().setToken(config.token);

  if (config.guildId) {
    // Override mode: register EVERY command to the given guild(s). Useful for fast
    // iteration. GUILD_ID may be a single id, comma list, or "all".
    let guildIds;
    if (config.guildId.trim().toLowerCase() === 'all') {
      const guilds = await rest.get(Routes.userGuilds());
      guildIds = guilds.map((g) => g.id);
      logger.info(`GUILD_ID=all -> deploying to ${guildIds.length} guild(s).`);
    } else {
      guildIds = config.guildId.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const jsons = all.map((c) => c.json);
    for (const gid of guildIds) await putGuild(rest, gid, jsons);
    return;
  }

  // Default mode: global commands go global; guild-pinned commands go to their guild.
  const globalCmds = all.filter((c) => !c.guildId).map((c) => c.json);
  const byGuild = new Map();
  for (const c of all) {
    if (!c.guildId) continue;
    if (!byGuild.has(c.guildId)) byGuild.set(c.guildId, []);
    byGuild.get(c.guildId).push(c.json);
  }

  const data = await rest.put(Routes.applicationCommands(config.clientId), { body: globalCmds });
  logger.info(`Registered ${data.length} global command(s) (may take up to ~1 hour to appear).`);

  for (const [gid, jsons] of byGuild) await putGuild(rest, gid, jsons);
}

main().catch((err) => {
  logger.error('Failed to register commands:', err);
  process.exit(1);
});
