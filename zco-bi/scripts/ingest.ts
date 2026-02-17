import fs from 'fs';
import path from 'path';
import { createPool } from '../src/db';
import { normalizeRawEvents } from '../src/normalizer';

function arg(flag: string): string | undefined {
  const idx = process.argv.findIndex((x) => x === flag || x.startsWith(`${flag}=`));
  if (idx < 0) return undefined;
  const direct = process.argv[idx];
  if (direct.includes('=')) return direct.split('=').slice(1).join('=');
  return process.argv[idx + 1];
}

function parseCsv(content: string): Array<Record<string, unknown>> {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((x) => x.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((x) => x.trim());
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ''; });
    return row;
  });
}

async function main(): Promise<void> {
  const source = arg('--source') || 'csv';
  const file = arg('--file');
  const pool = createPool();

  const { rows } = await pool.query(
    `INSERT INTO ingestion_runs(source, source_config, status) VALUES ($1, $2, 'running') RETURNING id`,
    [source, JSON.stringify({ file })]
  );
  const runId = rows[0].id as number;

  if (source === 'csv' && file) {
    const abs = path.resolve(file);
    const csv = fs.readFileSync(abs, 'utf8');
    const records = parseCsv(csv);
    for (const payload of records) {
      await pool.query(
        `INSERT INTO raw_events(run_id, source, source_id, event_type, payload)
         VALUES ($1, $2, $3, 'company_discovered', $4::jsonb)`,
        [runId, source, String(payload.id || payload.ID || ''), JSON.stringify(payload)]
      );
    }
  }

  const normalized = await normalizeRawEvents({ pool });
  await pool.query(
    `UPDATE ingestion_runs
     SET status='completed', completed_at=NOW(), rows_ingested=$2, rows_skipped=$3, rows_failed=$4
     WHERE id=$1`,
    [runId, normalized.created, normalized.skipped, normalized.errors.length]
  );
  console.log(JSON.stringify({ runId, normalized }, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
