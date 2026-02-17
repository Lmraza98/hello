import { createPool } from '../src/db';

function arg(flag: string): string | undefined {
  const idx = process.argv.findIndex((x) => x === flag || x.startsWith(`${flag}=`));
  if (idx < 0) return undefined;
  const direct = process.argv[idx];
  if (direct.includes('=')) return direct.split('=').slice(1).join('=');
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const companyId = arg('--company_id');
  const pool = createPool();
  if (companyId) {
    const { rows } = await pool.query(`SELECT * FROM score_company($1)`, [Number(companyId)]);
    console.log(JSON.stringify(rows[0] || {}, null, 2));
  } else {
    const { rows } = await pool.query(`SELECT * FROM score_all_companies()`);
    console.log(JSON.stringify(rows[0] || {}, null, 2));
  }
  await pool.query(`SELECT refresh_bi_views()`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
