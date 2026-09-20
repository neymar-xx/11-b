import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient as createRemoteClient } from '@libsql/client/web';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function configurationError(code, message) {
  return Object.assign(new Error(message), { code, status: 503 });
}

// The same SQL and transaction code runs locally and in Vercel Functions.
function wrap(client) {
  return {
    prepare(sql) {
      return {
        async get(...args) { return (await client.execute({ sql, args })).rows[0]; },
        async all(...args) { return (await client.execute({ sql, args })).rows; },
        async run(...args) { return client.execute({ sql, args }); },
      };
    },
    async batch(statements, mode = 'write') { return client.batch(statements, mode); },
    async transaction() { return wrap(await client.transaction('write')); },
    async commit() { return client.commit(); },
    async rollback() { return client.rollback(); },
    close() { client.close(); },
  };
}

export async function openDatabase(options = {}) {
  const serverless = options.serverless ?? process.env.VERCEL === '1';
  const url = options.databaseUrl ?? process.env.TURSO_DATABASE_URL;
  const authToken = options.databaseToken ?? process.env.TURSO_AUTH_TOKEN;
  if (serverless && !url) {
    throw configurationError('DATABASE_NOT_CONFIGURED', 'Vercel’da TURSO_DATABASE_URL va TURSO_AUTH_TOKEN sozlanmagan.');
  }
  if (url) {
    if (!/^(libsql|https):\/\//.test(url) || !authToken) {
      throw configurationError('DATABASE_NOT_CONFIGURED', 'TURSO_DATABASE_URL va TURSO_AUTH_TOKEN qiymatlarini tekshiring.');
    }
    // Remote requests use HTTP; no local replica, SQLite file or /tmp storage.
    const client = createRemoteClient({ url, authToken });
    return { db: wrap(client), bootstrapPath: null, remote: true };
  }
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(root, '.data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const databasePath = path.join(dataDir, 'fond.sqlite');
  const { createClient } = await import('@libsql/client');
  const client = createClient({ url: pathToFileURL(databasePath).href });
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA busy_timeout = 5000');
  chmodSync(databasePath, 0o600);
  return { db: wrap(client), bootstrapPath: path.join(dataDir, 'admin-password.txt'), remote: false };
}
