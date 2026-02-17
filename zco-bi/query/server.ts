import express, { Request, Response } from 'express';
import { createPool } from '../src/db';
import { startCollectorLoop } from '../src/collector';
import {
  getCampaignPerformance,
  getCompanyDetail,
  getCompanySignals,
  getContactRecommendations,
  getConversionAnalytics,
  getDailyDigest,
  getEngagementSummary,
  getNextBestActions,
  getPipelineByVertical,
  getScoreChanges,
  getSignalFeed,
  getTopProspects,
  searchCompanies,
} from '../src/query';

const app = express();
app.use(express.json({ limit: '1mb' }));
const pool = createPool();
const cfg = { pool };
const autoCollector = (process.env.AUTO_COLLECTOR || 'false').toLowerCase() === 'true';
const collectorLoop = autoCollector ? startCollectorLoop(pool) : null;

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post('/query/get_top_prospects', async (req, res) => res.json(await getTopProspects(cfg, req.body || {})));
app.post('/query/search_companies', async (req, res) => res.json(await searchCompanies(cfg, req.body || {})));
app.post('/query/get_company_detail', async (req, res) => res.json(await getCompanyDetail(cfg, req.body || {})));
app.post('/query/get_company_signals', async (req, res) => res.json(await getCompanySignals(cfg, req.body || {})));
app.post('/query/get_engagement_summary', async (req, res) => res.json(await getEngagementSummary(cfg, req.body || {})));
app.post('/query/get_contact_recommendations', async (req, res) => res.json(await getContactRecommendations(cfg, req.body || {})));
app.post('/query/get_pipeline_by_vertical', async (req, res) => res.json(await getPipelineByVertical(cfg, req.body || {})));
app.post('/query/get_conversion_analytics', async (req, res) => res.json(await getConversionAnalytics(cfg, req.body || {})));
app.post('/query/get_campaign_performance', async (req, res) => res.json(await getCampaignPerformance(cfg, req.body || {})));
app.post('/query/get_next_best_actions', async (req, res) => res.json(await getNextBestActions(cfg, req.body || {})));
app.post('/query/get_signal_feed', async (req, res) => res.json(await getSignalFeed(cfg, req.body || {})));
app.post('/query/get_daily_digest', async (_req, res) => res.json(await getDailyDigest(cfg)));
app.post('/query/get_score_changes', async (req, res) => res.json(await getScoreChanges(cfg, req.body || {})));

app.post('/query/score_companies', async (req, res) => {
  const companyId = req.body?.company_id as number | undefined;
  const sql = companyId ? 'SELECT * FROM score_company($1)' : 'SELECT * FROM score_all_companies()';
  const vals = companyId ? [companyId] : [];
  const { rows } = await pool.query(sql, vals);
  res.json(rows[0] || {});
});

app.post('/query/run_ingestion', async (req, res) => {
  const source = String(req.body?.source || 'manual');
  const config = req.body?.config || {};
  const { rows } = await pool.query(
    `INSERT INTO ingestion_runs(source, source_config, status, started_at, completed_at)
     VALUES ($1, $2::jsonb, 'partial', NOW(), NOW()) RETURNING id`,
    [source, JSON.stringify(config)]
  );
  res.json({ run_id: rows[0].id, status: 'queued' });
});

app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected error';
  res.status(500).json({ error: true, message });
});

const port = Number(process.env.PORT || 4010);
app.listen(port, () => {
  console.log(`Zco BI query server listening on ${port}`);
  if (collectorLoop) console.log('auto collector enabled');
});
