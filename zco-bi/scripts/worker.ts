import dotenv from 'dotenv';
import { createPool } from '../src/db';
import { runCollectorCycle, startCollectorLoop } from '../src/collector';
import { runSqliteCycle, startSqliteLoop } from '../src/sqliteCollector';
import { runSqliteSourceCollection } from '../src/sqliteSources';

dotenv.config({ path: 'config/sources.env' });
dotenv.config();

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const backend = (process.env.BI_BACKEND || 'sqlite').toLowerCase();
  if (backend === 'sqlite') {
    if (hasFlag('--once')) {
      await runSqliteSourceCollection();
      const result = await runSqliteCycle();
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const loop = startSqliteLoop({
      beforeCycle: runSqliteSourceCollection,
    });
    console.log('collector loop started (sqlite backend)');
    const shutdownSqlite = (): void => {
      loop.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdownSqlite);
    process.on('SIGTERM', shutdownSqlite);
    return;
  }

  const pool = createPool();
  if (hasFlag('--once')) {
    await runCollectorCycle(pool);
    await pool.end();
    console.log('collector cycle complete');
    return;
  }

  const loop = startCollectorLoop(pool);
  console.log('collector loop started (postgres backend)');

  const shutdown = async (): Promise<void> => {
    loop.stop();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch((err) => {
  const anyErr = err as { code?: string; errors?: Array<{ code?: string; address?: string; port?: number }> };
  const nestedRefused = Array.isArray(anyErr.errors) && anyErr.errors.some((e) => e.code === 'ECONNREFUSED');
  if (anyErr.code === 'ECONNREFUSED' || nestedRefused) {
    console.error('Postgres connection refused. Start PostgreSQL or update DATABASE_URL in zco-bi/config/sources.env.');
  }
  console.error(err);
  process.exit(1);
});
