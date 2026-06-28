/**
 * Make a consolidated single-file snapshot of the SQLite database. Safe to run
 * while the bot is live (uses SQLite's online backup; folds the WAL in).
 *
 *   npm run backup [destination.db]
 *
 * Copy the resulting file to another machine's data/ dir (rename to
 * nekonabot.db) to carry over all VC/message history.
 */
import Database from 'better-sqlite3';
import { config } from '../config.js';

const src = config.databasePath;
const dest = process.argv[2] || src.replace(/\.db$/i, '') + '-backup.db';

const source = new Database(src, { readonly: true, fileMustExist: true });
await source.backup(dest);

const snap = new Database(dest, { readonly: true });
const count = (t) => snap.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
console.log(`✅ Backup created: ${dest}`);
console.log(`   messages=${count('messages')}  vc_sessions=${count('vc_sessions')}  users=${count('users')}`);
snap.close();
source.close();
