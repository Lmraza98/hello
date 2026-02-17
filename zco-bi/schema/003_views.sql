-- ============================================================================
-- Zco BI Platform - Views & Materialized Views
-- ============================================================================

CREATE OR REPLACE VIEW v_company_summary AS
SELECT
  c.id,
  c.name,
  c.domain,
  c.vertical,
  c.sub_vertical,
  c.company_size,
  c.employee_count,
  c.hq_city,
  c.hq_state,
  c.hq_country,
  c.has_mobile_app,
  c.app_rating,
  c.app_review_count,
  c.tech_stack,
  c.tier,
  c.status,
  c.prospect_score,
  c.icp_fit_score,
  c.signal_score,
  c.engagement_score,
  c.last_funding_round,
  c.last_funding_amount,
  c.last_funding_date,
  c.total_funding,
  c.description,
  c.tags,
  c.first_seen_at,
  c.score_updated_at,
  (SELECT COUNT(*) FROM contacts ct WHERE ct.company_id = c.id) AS contact_count,
  (SELECT COUNT(*) FROM contacts ct WHERE ct.company_id = c.id AND ct.is_decision_maker) AS decision_maker_count,
  (SELECT COUNT(*) FROM signals s WHERE s.company_id = c.id AND s.is_active) AS active_signal_count,
  (SELECT MAX(s.detected_at) FROM signals s WHERE s.company_id = c.id AND s.is_active) AS latest_signal_at,
  (SELECT string_agg(DISTINCT s.signal_type, ', ') FROM signals s WHERE s.company_id = c.id AND s.is_active) AS active_signal_types,
  (SELECT COUNT(*) FROM activities a WHERE a.company_id = c.id) AS total_activities,
  (SELECT MAX(a.occurred_at) FROM activities a WHERE a.company_id = c.id) AS last_activity_at,
  (SELECT COUNT(*) FROM activities a WHERE a.company_id = c.id AND a.activity_type = 'email_replied') AS reply_count,
  (SELECT COUNT(*) FROM opportunities o WHERE o.company_id = c.id AND o.stage NOT IN ('closed_lost')) AS open_opportunities
FROM companies c;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_pipeline_summary AS
SELECT
  c.vertical,
  c.company_size,
  c.status AS company_status,
  COUNT(DISTINCT c.id) AS company_count,
  AVG(c.prospect_score) AS avg_prospect_score,
  COUNT(DISTINCT ct.id) FILTER (WHERE ct.is_decision_maker) AS decision_makers,
  COUNT(DISTINCT o.id) FILTER (WHERE o.stage NOT IN ('closed_won', 'closed_lost')) AS open_opps,
  SUM(o.estimated_value) FILTER (WHERE o.stage NOT IN ('closed_won', 'closed_lost')) AS open_pipeline_value,
  COUNT(DISTINCT o.id) FILTER (WHERE o.stage = 'closed_won') AS won_deals,
  SUM(o.actual_value) FILTER (WHERE o.stage = 'closed_won') AS won_revenue
FROM companies c
LEFT JOIN contacts ct ON ct.company_id = c.id
LEFT JOIN opportunities o ON o.company_id = c.id
GROUP BY c.vertical, c.company_size, c.status;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pipeline_summary
  ON mv_pipeline_summary(vertical, company_size, company_status);

CREATE OR REPLACE VIEW v_signal_feed AS
SELECT
  s.id AS signal_id,
  s.signal_type,
  s.signal_strength,
  s.title AS signal_title,
  s.description AS signal_description,
  s.evidence_url,
  s.metadata AS signal_metadata,
  s.detected_at,
  s.score_weight,
  c.id AS company_id,
  c.name AS company_name,
  c.vertical,
  c.prospect_score,
  c.tier,
  c.status AS company_status,
  c.has_mobile_app,
  c.app_rating
FROM signals s
JOIN companies c ON c.id = s.company_id
WHERE s.is_active = TRUE
ORDER BY s.detected_at DESC;

CREATE OR REPLACE VIEW v_engagement_timeline AS
SELECT
  a.id AS activity_id,
  a.company_id,
  c.name AS company_name,
  a.contact_id,
  ct.full_name AS contact_name,
  ct.title AS contact_title,
  a.activity_type,
  a.channel,
  a.direction,
  a.subject,
  a.occurred_at,
  a.campaign_id,
  a.sequence_step
FROM activities a
JOIN companies c ON c.id = a.company_id
LEFT JOIN contacts ct ON ct.id = a.contact_id
ORDER BY a.occurred_at DESC;

CREATE OR REPLACE VIEW v_campaign_performance AS
SELECT
  cp.id AS campaign_id,
  cp.name AS campaign_name,
  cp.status,
  cp.target_vertical,
  cp.contacts_enrolled,
  cp.emails_sent,
  cp.emails_opened,
  cp.emails_replied,
  cp.meetings_booked,
  CASE WHEN cp.emails_sent > 0
    THEN ROUND(cp.emails_opened::DECIMAL / cp.emails_sent * 100, 1)
    ELSE 0
  END AS open_rate,
  CASE WHEN cp.emails_sent > 0
    THEN ROUND(cp.emails_replied::DECIMAL / cp.emails_sent * 100, 1)
    ELSE 0
  END AS reply_rate,
  CASE WHEN cp.contacts_enrolled > 0
    THEN ROUND(cp.meetings_booked::DECIMAL / cp.contacts_enrolled * 100, 1)
    ELSE 0
  END AS meeting_rate
FROM campaigns cp;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_conversion_analytics AS
WITH won AS (
  SELECT company_id FROM opportunities WHERE stage = 'closed_won'
),
all_companies AS (
  SELECT
    c.id,
    c.vertical,
    c.company_size,
    c.employee_count,
    c.has_mobile_app,
    EXISTS(SELECT 1 FROM won w WHERE w.company_id = c.id) AS is_won
  FROM companies c
  WHERE c.status NOT IN ('new', 'disqualified')
)
SELECT
  vertical,
  company_size,
  COUNT(*) AS total_companies,
  COUNT(*) FILTER (WHERE is_won) AS won_companies,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(COUNT(*) FILTER (WHERE is_won)::DECIMAL / COUNT(*) * 100, 1)
    ELSE 0
  END AS conversion_rate
FROM all_companies
GROUP BY vertical, company_size;

CREATE OR REPLACE VIEW v_top_prospects AS
SELECT
  c.id,
  c.name,
  c.domain,
  c.vertical,
  c.company_size,
  c.employee_count,
  c.tier,
  c.prospect_score,
  c.icp_fit_score,
  c.signal_score,
  c.engagement_score,
  c.status,
  c.has_mobile_app,
  c.app_rating,
  c.last_funding_round,
  c.last_funding_date,
  c.total_funding,
  c.hq_city,
  c.hq_state,
  (SELECT COUNT(*) FROM contacts ct WHERE ct.company_id = c.id AND ct.is_decision_maker) AS decision_makers,
  (SELECT string_agg(DISTINCT s.signal_type, ', ' ORDER BY s.signal_type)
   FROM signals s WHERE s.company_id = c.id AND s.is_active) AS signals,
  (SELECT MAX(a.occurred_at) FROM activities a WHERE a.company_id = c.id) AS last_touched,
  CASE
    WHEN c.status IN ('new', 'researching') AND c.prospect_score >= 50 THEN 'ready_to_prospect'
    WHEN c.status = 'prospecting' AND c.engagement_score = 0 THEN 'needs_outreach'
    WHEN c.status = 'contacted' AND c.engagement_score > 0 THEN 'engaged_followup'
    WHEN c.status = 'engaged' THEN 'nurture_to_meeting'
    ELSE 'other'
  END AS recommended_action
FROM companies c
WHERE c.status NOT IN ('disqualified', 'customer', 'lost')
  AND c.prospect_score > 0
ORDER BY c.prospect_score DESC;

CREATE OR REPLACE VIEW v_daily_digest AS
SELECT
  'new_companies' AS category,
  COUNT(*) AS count,
  string_agg(name, ', ' ORDER BY prospect_score DESC) AS details
FROM companies
WHERE created_at >= CURRENT_DATE
UNION ALL
SELECT
  'new_signals',
  COUNT(*),
  string_agg(DISTINCT signal_type, ', ')
FROM signals
WHERE detected_at >= CURRENT_DATE AND is_active
UNION ALL
SELECT
  'emails_sent',
  COUNT(*),
  NULL
FROM activities
WHERE activity_type = 'email_sent' AND occurred_at >= CURRENT_DATE
UNION ALL
SELECT
  'replies_received',
  COUNT(*),
  NULL
FROM activities
WHERE activity_type = 'email_replied' AND occurred_at >= CURRENT_DATE AND direction = 'inbound'
UNION ALL
SELECT
  'meetings_booked',
  COUNT(*),
  NULL
FROM activities
WHERE activity_type = 'meeting_booked' AND occurred_at >= CURRENT_DATE;

CREATE OR REPLACE FUNCTION refresh_bi_views()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pipeline_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_conversion_analytics;
END;
$$ LANGUAGE plpgsql;
