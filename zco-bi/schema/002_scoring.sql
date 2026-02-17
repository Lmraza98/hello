-- ============================================================================
-- Zco BI Platform - Scoring Schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS scoring_weights (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL,
  factor      TEXT NOT NULL,
  weight      DECIMAL(5,2) NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category, factor)
);

INSERT INTO scoring_weights (category, factor, weight, description) VALUES
  ('icp', 'vertical_match', 20, 'Company is in a high-converting vertical for Zco'),
  ('icp', 'company_size_fit', 15, 'Company size matches Zco sweet spot (50-500 employees)'),
  ('icp', 'has_funding', 15, 'Company has raised venture funding'),
  ('icp', 'no_mobile_app', 20, 'Company has no mobile app yet'),
  ('icp', 'bad_app_rating', 15, 'Existing app rated below 3.5 stars'),
  ('icp', 'decision_maker_found', 15, 'We have a CTO/VP Eng/CEO contact'),
  ('signal', 'funding_round', 25, 'Just raised money - highest intent signal'),
  ('signal', 'hiring_developers', 20, 'Posting dev jobs = active build needs'),
  ('signal', 'hiring_product', 15, 'Posting product roles = planning new features'),
  ('signal', 'bad_app_reviews', 20, 'App has poor reviews - rebuild opportunity'),
  ('signal', 'no_mobile_app', 15, 'No app exists yet'),
  ('signal', 'outdated_tech_stack', 12, 'Running legacy technology'),
  ('signal', 'expansion_signal', 18, 'Announcing new markets or products'),
  ('signal', 'leadership_change', 14, 'New technical leadership = new priorities'),
  ('signal', 'rfp_posted', 30, 'Actively seeking development partners'),
  ('signal', 'content_engagement', 8, 'Engaged with our content'),
  ('signal', 'website_visit', 10, 'Visited zco.com'),
  ('signal', 'competitor_customer', 12, 'Using a competitor dev shop'),
  ('engagement', 'email_opened', 5, 'Opened our email'),
  ('engagement', 'email_replied', 25, 'Replied to our email'),
  ('engagement', 'email_clicked', 10, 'Clicked a link in our email'),
  ('engagement', 'linkedin_accepted', 15, 'Accepted LinkedIn connection'),
  ('engagement', 'linkedin_replied', 25, 'Replied to LinkedIn message'),
  ('engagement', 'call_connected', 20, 'Had a phone conversation'),
  ('engagement', 'meeting_held', 35, 'Meeting took place'),
  ('engagement', 'proposal_viewed', 20, 'Viewed our proposal')
ON CONFLICT (category, factor) DO NOTHING;

CREATE TABLE IF NOT EXISTS score_history (
  id               SERIAL PRIMARY KEY,
  company_id       INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  prospect_score   INT NOT NULL,
  icp_fit_score    INT NOT NULL,
  signal_score     INT NOT NULL,
  engagement_score INT NOT NULL,
  scored_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_history_company ON score_history(company_id, scored_at DESC);

CREATE OR REPLACE FUNCTION compute_icp_score(p_company_id INT)
RETURNS INT AS $$
DECLARE
  v_score INT := 0;
  v_company companies%ROWTYPE;
  v_has_decision_maker BOOLEAN;
  v_weight DECIMAL := 0;
BEGIN
  SELECT * INTO v_company FROM companies WHERE id = p_company_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF v_company.vertical IN ('Healthcare', 'Fintech', 'Logistics', 'Construction', 'Retail', 'Education', 'Insurance') THEN
    SELECT weight INTO v_weight FROM scoring_weights WHERE category = 'icp' AND factor = 'vertical_match';
    v_score := v_score + COALESCE(v_weight, 20);
  END IF;

  IF v_company.employee_count BETWEEN 50 AND 500 THEN
    SELECT weight INTO v_weight FROM scoring_weights WHERE category = 'icp' AND factor = 'company_size_fit';
    v_score := v_score + COALESCE(v_weight, 15);
  ELSIF v_company.employee_count BETWEEN 20 AND 50 OR v_company.employee_count BETWEEN 500 AND 2000 THEN
    v_score := v_score + 8;
  END IF;

  IF v_company.total_funding > 0 OR v_company.last_funding_date IS NOT NULL THEN
    SELECT weight INTO v_weight FROM scoring_weights WHERE category = 'icp' AND factor = 'has_funding';
    v_score := v_score + COALESCE(v_weight, 15);
  END IF;

  IF v_company.has_mobile_app = FALSE OR v_company.has_mobile_app IS NULL THEN
    SELECT weight INTO v_weight FROM scoring_weights WHERE category = 'icp' AND factor = 'no_mobile_app';
    v_score := v_score + COALESCE(v_weight, 20);
  END IF;

  IF v_company.has_mobile_app = TRUE AND v_company.app_rating IS NOT NULL AND v_company.app_rating < 3.5 THEN
    SELECT weight INTO v_weight FROM scoring_weights WHERE category = 'icp' AND factor = 'bad_app_rating';
    v_score := v_score + COALESCE(v_weight, 15);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM contacts WHERE company_id = p_company_id AND is_decision_maker = TRUE
  ) INTO v_has_decision_maker;
  IF v_has_decision_maker THEN
    SELECT weight INTO v_weight FROM scoring_weights WHERE category = 'icp' AND factor = 'decision_maker_found';
    v_score := v_score + COALESCE(v_weight, 15);
  END IF;

  RETURN LEAST(v_score, 100);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION compute_signal_score(p_company_id INT)
RETURNS INT AS $$
DECLARE
  v_score DECIMAL := 0;
  sig RECORD;
  v_weight DECIMAL := 0;
  v_recency_factor DECIMAL;
BEGIN
  FOR sig IN
    SELECT signal_type, signal_strength, detected_at, score_weight
    FROM signals
    WHERE company_id = p_company_id AND is_active = TRUE
    ORDER BY detected_at DESC
    LIMIT 20
  LOOP
    SELECT weight INTO v_weight FROM scoring_weights WHERE category = 'signal' AND factor = sig.signal_type;
    v_recency_factor := GREATEST(0.2, 1.0 - (EXTRACT(EPOCH FROM (NOW() - sig.detected_at)) / (90 * 86400)) * 0.5);
    v_score := v_score + (
      COALESCE(v_weight, sig.score_weight) *
      v_recency_factor *
      CASE sig.signal_strength
        WHEN 'critical' THEN 1.5
        WHEN 'strong' THEN 1.2
        WHEN 'medium' THEN 1.0
        WHEN 'weak' THEN 0.6
        ELSE 1.0
      END
    );
  END LOOP;
  RETURN LEAST(ROUND(v_score)::INT, 100);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION compute_engagement_score(p_company_id INT)
RETURNS INT AS $$
DECLARE
  v_score DECIMAL := 0;
  act RECORD;
  v_weight DECIMAL := 0;
  v_recency_factor DECIMAL;
BEGIN
  FOR act IN
    SELECT activity_type, occurred_at
    FROM activities
    WHERE company_id = p_company_id
      AND direction IN ('inbound', 'outbound')
      AND occurred_at > NOW() - INTERVAL '90 days'
    ORDER BY occurred_at DESC
    LIMIT 30
  LOOP
    SELECT weight INTO v_weight FROM scoring_weights
    WHERE category = 'engagement'
      AND factor = act.activity_type;

    IF v_weight IS NOT NULL THEN
      v_recency_factor := GREATEST(0.3, 1.0 - (EXTRACT(EPOCH FROM (NOW() - act.occurred_at)) / (90 * 86400)) * 0.7);
      v_score := v_score + (v_weight * v_recency_factor);
    END IF;
  END LOOP;
  RETURN LEAST(ROUND(v_score)::INT, 100);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION score_company(p_company_id INT)
RETURNS TABLE(prospect_score INT, icp_fit_score INT, signal_score INT, engagement_score INT) AS $$
DECLARE
  v_icp INT;
  v_signal INT;
  v_engagement INT;
  v_composite INT;
BEGIN
  v_icp := compute_icp_score(p_company_id);
  v_signal := compute_signal_score(p_company_id);
  v_engagement := compute_engagement_score(p_company_id);

  v_composite := ROUND(v_icp * 0.30 + v_signal * 0.45 + v_engagement * 0.25);
  v_composite := LEAST(v_composite, 100);

  UPDATE companies SET
    prospect_score = v_composite,
    icp_fit_score = v_icp,
    signal_score = v_signal,
    engagement_score = v_engagement,
    score_updated_at = NOW(),
    tier = CASE
      WHEN v_composite >= 70 THEN 'A'
      WHEN v_composite >= 40 THEN 'B'
      WHEN v_composite >= 15 THEN 'C'
      ELSE 'unscored'
    END
  WHERE id = p_company_id;

  INSERT INTO score_history (company_id, prospect_score, icp_fit_score, signal_score, engagement_score)
  VALUES (p_company_id, v_composite, v_icp, v_signal, v_engagement);

  RETURN QUERY SELECT v_composite, v_icp, v_signal, v_engagement;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION score_all_companies()
RETURNS TABLE(scored_count INT) AS $$
DECLARE
  v_count INT := 0;
  v_company_id INT;
BEGIN
  FOR v_company_id IN SELECT id FROM companies WHERE status != 'disqualified'
  LOOP
    PERFORM score_company(v_company_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql;
