-- ============================================================================
-- Zco BI Platform - Canonical Schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id              SERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  source_config   JSONB DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'running',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  rows_ingested   INT DEFAULT 0,
  rows_skipped    INT DEFAULT 0,
  rows_failed     INT DEFAULT 0,
  error_log       TEXT,
  created_by      TEXT DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS raw_events (
  id              SERIAL PRIMARY KEY,
  run_id          INT REFERENCES ingestion_runs(id),
  source          TEXT NOT NULL,
  source_id       TEXT,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  payload_hash    TEXT,
  normalized      BOOLEAN DEFAULT FALSE,
  normalized_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_events_source ON raw_events(source, source_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_hash ON raw_events(payload_hash);
CREATE INDEX IF NOT EXISTS idx_raw_events_normalized ON raw_events(normalized) WHERE NOT normalized;
CREATE INDEX IF NOT EXISTS idx_raw_events_type ON raw_events(event_type);

CREATE TABLE IF NOT EXISTS companies (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  domain              TEXT,
  linkedin_url        TEXT,
  salesnav_account_id TEXT,
  vertical            TEXT,
  sub_vertical        TEXT,
  company_size        TEXT,
  employee_count      INT,
  employee_range      TEXT,
  hq_city             TEXT,
  hq_state            TEXT,
  hq_country          TEXT DEFAULT 'US',
  estimated_revenue   TEXT,
  last_funding_amount BIGINT,
  last_funding_round  TEXT,
  last_funding_date   DATE,
  total_funding       BIGINT,
  has_mobile_app      BOOLEAN,
  app_store_url       TEXT,
  play_store_url      TEXT,
  app_rating          DECIMAL(2,1),
  app_review_count    INT,
  tech_stack          TEXT[],
  tier                TEXT DEFAULT 'unscored',
  status              TEXT DEFAULT 'new',
  prospect_score      INT DEFAULT 0,
  icp_fit_score       INT DEFAULT 0,
  signal_score        INT DEFAULT 0,
  engagement_score    INT DEFAULT 0,
  score_updated_at    TIMESTAMPTZ,
  description         TEXT,
  notes               TEXT,
  tags                TEXT[],
  source              TEXT,
  source_id           TEXT,
  first_seen_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain) WHERE domain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_salesnav ON companies(salesnav_account_id) WHERE salesnav_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_vertical ON companies(vertical);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_tier ON companies(tier);
CREATE INDEX IF NOT EXISTS idx_companies_score ON companies(prospect_score DESC);
CREATE INDEX IF NOT EXISTS idx_companies_size ON companies(company_size);

CREATE TABLE IF NOT EXISTS contacts (
  id                  SERIAL PRIMARY KEY,
  company_id          INT REFERENCES companies(id) ON DELETE SET NULL,
  first_name          TEXT,
  last_name           TEXT,
  full_name           TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  linkedin_url        TEXT,
  salesnav_lead_id    TEXT,
  title               TEXT,
  seniority           TEXT,
  department          TEXT,
  is_decision_maker   BOOLEAN DEFAULT FALSE,
  status              TEXT DEFAULT 'new',
  last_contacted_at   TIMESTAMPTZ,
  last_replied_at     TIMESTAMPTZ,
  contact_count       INT DEFAULT 0,
  notes               TEXT,
  tags                TEXT[],
  source              TEXT,
  source_id           TEXT,
  first_seen_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_linkedin ON contacts(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_salesnav ON contacts(salesnav_lead_id) WHERE salesnav_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_seniority ON contacts(seniority);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_decision_maker ON contacts(is_decision_maker) WHERE is_decision_maker;

CREATE TABLE IF NOT EXISTS signals (
  id              SERIAL PRIMARY KEY,
  company_id      INT REFERENCES companies(id) ON DELETE CASCADE,
  contact_id      INT REFERENCES contacts(id) ON DELETE SET NULL,
  raw_event_id    INT REFERENCES raw_events(id),
  signal_type     TEXT NOT NULL,
  signal_strength TEXT NOT NULL DEFAULT 'medium',
  title           TEXT NOT NULL,
  description     TEXT,
  evidence_url    TEXT,
  metadata        JSONB DEFAULT '{}',
  score_weight    INT DEFAULT 10,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT TRUE,
  acknowledged    BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_company ON signals(company_id);
CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_strength ON signals(signal_strength);
CREATE INDEX IF NOT EXISTS idx_signals_active ON signals(is_active, detected_at DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_signals_company_active ON signals(company_id, is_active, detected_at DESC);

CREATE TABLE IF NOT EXISTS activities (
  id              SERIAL PRIMARY KEY,
  company_id      INT REFERENCES companies(id) ON DELETE SET NULL,
  contact_id      INT REFERENCES contacts(id) ON DELETE SET NULL,
  activity_type   TEXT NOT NULL,
  channel         TEXT,
  direction       TEXT DEFAULT 'outbound',
  subject         TEXT,
  body            TEXT,
  metadata        JSONB DEFAULT '{}',
  campaign_id     INT,
  sequence_step   INT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_company ON activities(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_channel ON activities(channel);
CREATE INDEX IF NOT EXISTS idx_activities_campaign ON activities(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(occurred_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  id                 SERIAL PRIMARY KEY,
  company_id         INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id         INT REFERENCES contacts(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  stage              TEXT NOT NULL DEFAULT 'qualified',
  estimated_value    BIGINT,
  actual_value       BIGINT,
  project_type       TEXT,
  platforms          TEXT[],
  estimated_duration TEXT,
  loss_reason        TEXT,
  win_factors        TEXT[],
  competitors        TEXT[],
  created_date       DATE DEFAULT CURRENT_DATE,
  expected_close     DATE,
  actual_close_date  DATE,
  last_activity_at   TIMESTAMPTZ,
  notes              TEXT,
  tags               TEXT[],
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(company_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage);
CREATE INDEX IF NOT EXISTS idx_opportunities_value ON opportunities(estimated_value DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_opportunities_close ON opportunities(expected_close) WHERE stage NOT IN ('closed_won', 'closed_lost');

CREATE TABLE IF NOT EXISTS campaigns (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT,
  status              TEXT DEFAULT 'draft',
  campaign_type       TEXT DEFAULT 'outbound',
  target_vertical     TEXT,
  target_company_size TEXT,
  target_seniority    TEXT[],
  contacts_enrolled   INT DEFAULT 0,
  emails_sent         INT DEFAULT 0,
  emails_opened       INT DEFAULT 0,
  emails_replied      INT DEFAULT 0,
  meetings_booked     INT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_steps (
  id               SERIAL PRIMARY KEY,
  campaign_id      INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_number      INT NOT NULL,
  step_type        TEXT DEFAULT 'email',
  delay_days       INT DEFAULT 0,
  subject_template TEXT,
  body_template    TEXT,
  metadata         JSONB DEFAULT '{}',
  UNIQUE(campaign_id, step_number)
);

CREATE TABLE IF NOT EXISTS campaign_enrollments (
  id           SERIAL PRIMARY KEY,
  campaign_id  INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id   INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  current_step INT DEFAULT 1,
  status       TEXT DEFAULT 'active',
  enrolled_at  TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(campaign_id, contact_id)
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['companies', 'contacts', 'opportunities', 'campaigns'])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      tbl, tbl
    );
  END LOOP;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
