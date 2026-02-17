import { Pool } from 'pg';

export interface QueryConfig {
  pool: Pool;
}

export interface ProspectResult {
  id: number;
  name: string;
  domain: string | null;
  vertical: string | null;
  company_size: string | null;
  employee_count: number | null;
  tier: string;
  prospect_score: number;
  icp_fit_score: number;
  signal_score: number;
  engagement_score: number;
  status: string;
  has_mobile_app: boolean | null;
  app_rating: number | null;
  last_funding_round: string | null;
  total_funding: number | null;
  hq_city: string | null;
  hq_state: string | null;
  decision_makers: number;
  signals: string | null;
  last_touched: string | null;
  recommended_action: string;
}

export interface CompanyDetail {
  id: number;
  name: string;
  domain: string | null;
  vertical: string | null;
  sub_vertical: string | null;
  company_size: string | null;
  employee_count: number | null;
  hq_city: string | null;
  hq_state: string | null;
  hq_country: string | null;
  has_mobile_app: boolean | null;
  app_rating: number | null;
  app_review_count: number | null;
  tech_stack: string[] | null;
  tier: string;
  status: string;
  prospect_score: number;
  icp_fit_score: number;
  signal_score: number;
  engagement_score: number;
  last_funding_round: string | null;
  last_funding_amount: number | null;
  total_funding: number | null;
  description: string | null;
  tags: string[] | null;
  contact_count: number;
  decision_maker_count: number;
  active_signal_count: number;
  active_signal_types: string | null;
  total_activities: number;
  last_activity_at: string | null;
  reply_count: number;
  open_opportunities: number;
}

export interface SignalResult {
  signal_id: number;
  signal_type: string;
  signal_strength: string;
  signal_title: string;
  signal_description: string | null;
  evidence_url: string | null;
  signal_metadata: Record<string, unknown>;
  detected_at: string;
  company_id: number;
  company_name: string;
  vertical: string | null;
  prospect_score: number;
  tier: string;
}

export interface ContactResult {
  id: number;
  company_id: number | null;
  company_name: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  is_decision_maker: boolean;
  status: string;
  last_contacted_at: string | null;
  last_replied_at: string | null;
  contact_count: number;
}

export interface EngagementEvent {
  activity_id: number;
  activity_type: string;
  channel: string | null;
  direction: string;
  subject: string | null;
  occurred_at: string;
  contact_name: string | null;
  contact_title: string | null;
}

export interface PipelineSegment {
  vertical: string | null;
  company_size: string | null;
  company_status: string;
  company_count: number;
  avg_prospect_score: number;
  decision_makers: number;
  open_opps: number;
  open_pipeline_value: number | null;
  won_deals: number;
  won_revenue: number | null;
}

export interface ConversionRow {
  vertical: string | null;
  company_size: string | null;
  total_companies: number;
  won_companies: number;
  conversion_rate: number;
}

export interface DailyDigestRow {
  category: string;
  count: number;
  details: string | null;
}

export interface CampaignPerformance {
  campaign_id: number;
  campaign_name: string;
  status: string;
  target_vertical: string | null;
  contacts_enrolled: number;
  emails_sent: number;
  emails_opened: number;
  emails_replied: number;
  meetings_booked: number;
  open_rate: number;
  reply_rate: number;
  meeting_rate: number;
}

function boundedDays(days: number | undefined, fallback: number): number {
  return Math.min(days || fallback, 365);
}

export async function getTopProspects(
  config: QueryConfig,
  params: {
    vertical?: string;
    company_size?: string;
    min_score?: number;
    tier?: string;
    status?: string;
    has_signal_type?: string;
    has_mobile_app?: boolean;
    state?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<ProspectResult[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 0;

  if (params.vertical) { conditions.push(`vertical = $${++paramIdx}`); values.push(params.vertical); }
  if (params.company_size) { conditions.push(`company_size = $${++paramIdx}`); values.push(params.company_size); }
  if (params.min_score != null) { conditions.push(`prospect_score >= $${++paramIdx}`); values.push(params.min_score); }
  if (params.tier) { conditions.push(`tier = $${++paramIdx}`); values.push(params.tier); }
  if (params.status) { conditions.push(`status = $${++paramIdx}`); values.push(params.status); }
  if (params.has_signal_type) { conditions.push(`signals LIKE '%' || $${++paramIdx} || '%'`); values.push(params.has_signal_type); }
  if (params.has_mobile_app != null) { conditions.push(`has_mobile_app = $${++paramIdx}`); values.push(params.has_mobile_app); }
  if (params.state) { conditions.push(`hq_state = $${++paramIdx}`); values.push(params.state); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 25;
  const offset = params.offset || 0;

  const { rows } = await config.pool.query(
    `SELECT * FROM v_top_prospects ${where} ORDER BY prospect_score DESC LIMIT $${++paramIdx} OFFSET $${++paramIdx}`,
    [...values, limit, offset]
  );
  return rows;
}

export async function getCompanyDetail(
  config: QueryConfig,
  params: { company_id?: number; domain?: string; name?: string }
): Promise<CompanyDetail | null> {
  let query: string;
  let values: unknown[];
  if (params.company_id) {
    query = `SELECT * FROM v_company_summary WHERE id = $1`;
    values = [params.company_id];
  } else if (params.domain) {
    query = `SELECT * FROM v_company_summary WHERE domain = $1`;
    values = [params.domain];
  } else if (params.name) {
    query = `SELECT * FROM v_company_summary WHERE LOWER(name) LIKE LOWER($1) LIMIT 1`;
    values = [`%${params.name}%`];
  } else {
    return null;
  }
  const { rows } = await config.pool.query(query, values);
  return rows[0] || null;
}

export async function getCompanySignals(
  config: QueryConfig,
  params: {
    company_id?: number;
    signal_type?: string;
    signal_strength?: string;
    days?: number;
    limit?: number;
  } = {}
): Promise<SignalResult[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 0;

  if (params.company_id) { conditions.push(`company_id = $${++paramIdx}`); values.push(params.company_id); }
  if (params.signal_type) { conditions.push(`signal_type = $${++paramIdx}`); values.push(params.signal_type); }
  if (params.signal_strength) { conditions.push(`signal_strength = $${++paramIdx}`); values.push(params.signal_strength); }
  if (params.days) { conditions.push(`detected_at > NOW() - ($${++paramIdx}::int * INTERVAL '1 day')`); values.push(boundedDays(params.days, 365)); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 50;
  const { rows } = await config.pool.query(
    `SELECT * FROM v_signal_feed ${where} ORDER BY detected_at DESC LIMIT $${++paramIdx}`,
    [...values, limit]
  );
  return rows;
}

export async function getEngagementSummary(
  config: QueryConfig,
  params: { company_id: number; days?: number; channel?: string; limit?: number }
): Promise<{
  company_name: string | null;
  total_activities: number;
  channels: Record<string, number>;
  recent: EngagementEvent[];
  summary: {
    emails_sent: number;
    emails_opened: number;
    emails_replied: number;
    calls_made: number;
    calls_connected: number;
    meetings_held: number;
    linkedin_messages: number;
    linkedin_replies: number;
  };
}> {
  const days = boundedDays(params.days, 90);
  const limit = params.limit || 30;
  const baseVals: unknown[] = [params.company_id, days, limit];
  let recentSql = `SELECT * FROM v_engagement_timeline
     WHERE company_id = $1 AND occurred_at > NOW() - ($2::int * INTERVAL '1 day')`;
  if (params.channel) {
    recentSql += ` AND channel = $4`;
    baseVals.push(params.channel);
  }
  recentSql += ` ORDER BY occurred_at DESC LIMIT $3`;
  const { rows: activities } = await config.pool.query(recentSql, baseVals);
  const { rows: agg } = await config.pool.query(
    `SELECT activity_type, COUNT(*) as cnt
     FROM activities
     WHERE company_id = $1 AND occurred_at > NOW() - ($2::int * INTERVAL '1 day')
     GROUP BY activity_type`,
    [params.company_id, days]
  );

  const counts = new Map<string, number>(
    agg.map((r: { activity_type: string; cnt: string }) => [r.activity_type, parseInt(r.cnt, 10)] as [string, number])
  );
  const channelCounts: Record<string, number> = {};
  for (const act of activities) {
    if (act.channel) channelCounts[act.channel as string] = (channelCounts[act.channel as string] || 0) + 1;
  }

  return {
    company_name: (activities[0]?.company_name as string | undefined) || null,
    total_activities: activities.length,
    channels: channelCounts,
    recent: activities,
    summary: {
      emails_sent: counts.get('email_sent') || 0,
      emails_opened: counts.get('email_opened') || 0,
      emails_replied: counts.get('email_replied') || 0,
      calls_made: counts.get('call_made') || 0,
      calls_connected: counts.get('call_connected') || 0,
      meetings_held: counts.get('meeting_held') || 0,
      linkedin_messages: counts.get('linkedin_message_sent') || 0,
      linkedin_replies: counts.get('linkedin_message_replied') || 0,
    },
  };
}

export async function getContactRecommendations(
  config: QueryConfig,
  params: {
    company_id?: number;
    seniority?: string;
    department?: string;
    has_email?: boolean;
    status?: string;
    limit?: number;
  } = {}
): Promise<ContactResult[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 0;
  if (params.company_id) { conditions.push(`c.company_id = $${++paramIdx}`); values.push(params.company_id); }
  if (params.seniority) { conditions.push(`c.seniority = $${++paramIdx}`); values.push(params.seniority); }
  if (params.department) { conditions.push(`c.department = $${++paramIdx}`); values.push(params.department); }
  if (params.has_email) conditions.push(`c.email IS NOT NULL`);
  if (params.status) { conditions.push(`c.status = $${++paramIdx}`); values.push(params.status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 20;
  const { rows } = await config.pool.query(
    `SELECT
      c.id, c.company_id, co.name AS company_name, c.full_name, c.email, c.phone,
      c.linkedin_url, c.title, c.seniority, c.department, c.is_decision_maker,
      c.status, c.last_contacted_at, c.last_replied_at, c.contact_count
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    ${where}
    ORDER BY
      c.is_decision_maker DESC,
      CASE c.seniority
        WHEN 'c_suite' THEN 1
        WHEN 'vp' THEN 2
        WHEN 'director' THEN 3
        WHEN 'manager' THEN 4
        ELSE 5
      END,
      c.email IS NOT NULL DESC
    LIMIT $${++paramIdx}`,
    [...values, limit]
  );
  return rows;
}

export async function getPipelineByVertical(
  config: QueryConfig,
  params: { vertical?: string; company_size?: string } = {}
): Promise<PipelineSegment[]> {
  let query = `SELECT * FROM mv_pipeline_summary WHERE 1=1`;
  const values: unknown[] = [];
  let paramIdx = 0;
  if (params.vertical) { query += ` AND vertical = $${++paramIdx}`; values.push(params.vertical); }
  if (params.company_size) { query += ` AND company_size = $${++paramIdx}`; values.push(params.company_size); }
  query += ` ORDER BY company_count DESC`;
  const { rows } = await config.pool.query(query, values);
  return rows;
}

export async function getConversionAnalytics(
  config: QueryConfig,
  params: { vertical?: string } = {}
): Promise<ConversionRow[]> {
  let query = `SELECT * FROM mv_conversion_analytics WHERE total_companies > 0`;
  const values: unknown[] = [];
  let paramIdx = 0;
  if (params.vertical) { query += ` AND vertical = $${++paramIdx}`; values.push(params.vertical); }
  query += ` ORDER BY conversion_rate DESC`;
  const { rows } = await config.pool.query(query, values);
  return rows;
}

export async function getSignalFeed(
  config: QueryConfig,
  params: { signal_types?: string[]; min_prospect_score?: number; tier?: string; days?: number; limit?: number } = {}
): Promise<SignalResult[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 0;
  if (params.signal_types?.length) { conditions.push(`signal_type = ANY($${++paramIdx})`); values.push(params.signal_types); }
  if (params.min_prospect_score != null) { conditions.push(`prospect_score >= $${++paramIdx}`); values.push(params.min_prospect_score); }
  if (params.tier) { conditions.push(`tier = $${++paramIdx}`); values.push(params.tier); }
  if (params.days) { conditions.push(`detected_at > NOW() - ($${++paramIdx}::int * INTERVAL '1 day')`); values.push(boundedDays(params.days, 365)); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 50;
  const { rows } = await config.pool.query(
    `SELECT * FROM v_signal_feed ${where} ORDER BY detected_at DESC LIMIT $${++paramIdx}`,
    [...values, limit]
  );
  return rows;
}

export async function getDailyDigest(config: QueryConfig): Promise<DailyDigestRow[]> {
  const { rows } = await config.pool.query(`SELECT * FROM v_daily_digest`);
  return rows;
}

export async function getCampaignPerformance(
  config: QueryConfig,
  params: { campaign_id?: number; status?: string } = {}
): Promise<CampaignPerformance[]> {
  let query = `SELECT * FROM v_campaign_performance WHERE 1=1`;
  const values: unknown[] = [];
  let paramIdx = 0;
  if (params.campaign_id) { query += ` AND campaign_id = $${++paramIdx}`; values.push(params.campaign_id); }
  if (params.status) { query += ` AND status = $${++paramIdx}`; values.push(params.status); }
  query += ` ORDER BY contacts_enrolled DESC`;
  const { rows } = await config.pool.query(query, values);
  return rows;
}

export async function searchCompanies(
  config: QueryConfig,
  params: {
    q?: string;
    vertical?: string;
    tier?: string;
    status?: string;
    company_size?: string;
    min_score?: number;
    has_mobile_app?: boolean;
    state?: string;
    limit?: number;
  } = {}
): Promise<ProspectResult[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 0;
  if (params.q) {
    conditions.push(
      `(LOWER(name) LIKE LOWER($${++paramIdx}) OR LOWER(description) LIKE LOWER($${paramIdx}) OR LOWER(vertical) LIKE LOWER($${paramIdx}))`
    );
    values.push(`%${params.q}%`);
  }
  if (params.vertical) { conditions.push(`vertical = $${++paramIdx}`); values.push(params.vertical); }
  if (params.tier) { conditions.push(`tier = $${++paramIdx}`); values.push(params.tier); }
  if (params.status) { conditions.push(`status = $${++paramIdx}`); values.push(params.status); }
  if (params.company_size) { conditions.push(`company_size = $${++paramIdx}`); values.push(params.company_size); }
  if (params.min_score != null) { conditions.push(`prospect_score >= $${++paramIdx}`); values.push(params.min_score); }
  if (params.has_mobile_app != null) { conditions.push(`has_mobile_app = $${++paramIdx}`); values.push(params.has_mobile_app); }
  if (params.state) { conditions.push(`hq_state = $${++paramIdx}`); values.push(params.state); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 25;
  const { rows } = await config.pool.query(
    `SELECT * FROM v_top_prospects ${where} ORDER BY prospect_score DESC LIMIT $${++paramIdx}`,
    [...values, limit]
  );
  return rows;
}

export async function getNextBestActions(
  config: QueryConfig,
  params: { limit?: number } = {}
): Promise<Array<{
  action: string;
  priority: string;
  company_id: number;
  company_name: string;
  prospect_score: number;
  reason: string;
  contact_name?: string;
  contact_email?: string;
}>> {
  const limit = params.limit || 15;
  const { rows: uncontacted } = await config.pool.query(
    `SELECT c.id, c.name, c.prospect_score,
      (SELECT ct.full_name FROM contacts ct WHERE ct.company_id = c.id AND ct.is_decision_maker ORDER BY ct.seniority LIMIT 1) AS contact_name,
      (SELECT ct.email FROM contacts ct WHERE ct.company_id = c.id AND ct.is_decision_maker AND ct.email IS NOT NULL ORDER BY ct.seniority LIMIT 1) AS contact_email,
      string_agg(DISTINCT s.signal_type, ', ') AS signals
    FROM companies c
    LEFT JOIN signals s ON s.company_id = c.id AND s.is_active
    WHERE c.status IN ('new', 'researching', 'prospecting')
      AND c.prospect_score >= 40
      AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.company_id = c.id AND a.direction = 'outbound')
    GROUP BY c.id
    ORDER BY c.prospect_score DESC
    LIMIT $1`,
    [limit]
  );
  const { rows: engaged } = await config.pool.query(
    `SELECT DISTINCT c.id, c.name, c.prospect_score,
      ct.full_name AS contact_name, ct.email AS contact_email
    FROM companies c
    JOIN activities a ON a.company_id = c.id AND a.activity_type = 'email_replied' AND a.direction = 'inbound'
    LEFT JOIN contacts ct ON ct.id = a.contact_id
    WHERE NOT EXISTS (
      SELECT 1 FROM activities a2 WHERE a2.company_id = c.id AND a2.activity_type IN ('meeting_booked', 'meeting_held')
    )
    ORDER BY c.prospect_score DESC
    LIMIT $1`,
    [limit]
  );
  const { rows: hotSignals } = await config.pool.query(
    `SELECT s.company_id, c.name, c.prospect_score, s.signal_type, s.title AS signal_title
    FROM signals s
    JOIN companies c ON c.id = s.company_id
    WHERE s.is_active AND s.signal_strength IN ('strong', 'critical')
      AND s.detected_at > NOW() - INTERVAL '14 days'
      AND NOT s.acknowledged
    ORDER BY s.detected_at DESC
    LIMIT $1`,
    [limit]
  );
  const actions: Array<{
    action: string;
    priority: string;
    company_id: number;
    company_name: string;
    prospect_score: number;
    reason: string;
    contact_name?: string;
    contact_email?: string;
  }> = [];
  for (const row of hotSignals) {
    actions.push({
      action: 'investigate_signal',
      priority: 'high',
      company_id: row.company_id as number,
      company_name: row.name as string,
      prospect_score: row.prospect_score as number,
      reason: `New strong signal: ${row.signal_title as string}`,
    });
  }
  for (const row of engaged) {
    actions.push({
      action: 'book_meeting',
      priority: 'high',
      company_id: row.id as number,
      company_name: row.name as string,
      prospect_score: row.prospect_score as number,
      reason: 'Replied to outreach but no meeting booked yet',
      contact_name: row.contact_name as string | undefined,
      contact_email: row.contact_email as string | undefined,
    });
  }
  for (const row of uncontacted) {
    actions.push({
      action: 'initial_outreach',
      priority: (row.prospect_score as number) >= 70 ? 'high' : 'medium',
      company_id: row.id as number,
      company_name: row.name as string,
      prospect_score: row.prospect_score as number,
      reason: `Score ${row.prospect_score as number}, signals: ${(row.signals as string | null) || 'none'}, not yet contacted`,
      contact_name: row.contact_name as string | undefined,
      contact_email: row.contact_email as string | undefined,
    });
  }
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) =>
    (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2) ||
    b.prospect_score - a.prospect_score
  );
  return actions.slice(0, limit);
}

export async function getScoreChanges(
  config: QueryConfig,
  params: { days?: number; min_delta?: number; limit?: number } = {}
): Promise<Array<{
  company_id: number;
  company_name: string;
  current_score: number;
  previous_score: number;
  delta: number;
  vertical: string | null;
  tier: string;
}>> {
  const days = Math.min(params.days || 7, 90);
  const minDelta = params.min_delta || 5;
  const limit = params.limit || 25;
  const { rows } = await config.pool.query(
    `WITH latest AS (
      SELECT DISTINCT ON (company_id) company_id, prospect_score, scored_at
      FROM score_history
      ORDER BY company_id, scored_at DESC
    ),
    previous AS (
      SELECT DISTINCT ON (sh.company_id) sh.company_id, sh.prospect_score
      FROM score_history sh
      JOIN latest l ON l.company_id = sh.company_id AND sh.scored_at < l.scored_at
      WHERE sh.scored_at > NOW() - ($3::int * INTERVAL '1 day')
      ORDER BY sh.company_id, sh.scored_at DESC
    )
    SELECT
      c.id AS company_id,
      c.name AS company_name,
      l.prospect_score AS current_score,
      p.prospect_score AS previous_score,
      (l.prospect_score - p.prospect_score) AS delta,
      c.vertical,
      c.tier
    FROM latest l
    JOIN previous p ON p.company_id = l.company_id
    JOIN companies c ON c.id = l.company_id
    WHERE ABS(l.prospect_score - p.prospect_score) >= $1
    ORDER BY (l.prospect_score - p.prospect_score) DESC
    LIMIT $2`,
    [minDelta, limit, days]
  );
  return rows;
}
