import { Pool } from 'pg';

export interface NormalizerConfig {
  pool: Pool;
  dryRun?: boolean;
}

export interface NormalizeResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ eventId: number; error: string }>;
}

type CompanyFields = {
  name: string;
  domain?: string;
  linkedin_url?: string;
  salesnav_account_id?: string;
  vertical?: string;
  sub_vertical?: string;
  employee_count?: number;
  employee_range?: string;
  hq_city?: string;
  hq_state?: string;
  hq_country?: string;
  description?: string;
  has_mobile_app?: boolean;
  app_store_url?: string;
  play_store_url?: string;
  app_rating?: number;
  app_review_count?: number;
  tech_stack?: string[];
  last_funding_amount?: number;
  last_funding_round?: string;
  last_funding_date?: string;
  total_funding?: number;
  estimated_revenue?: string;
  source: string;
  source_id?: string;
};

type ContactFields = {
  full_name: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  salesnav_lead_id?: string;
  title?: string;
  seniority?: string;
  department?: string;
  company_name?: string;
  company_domain?: string;
  source: string;
  source_id?: string;
};

type SignalFields = {
  company_name?: string;
  company_domain?: string;
  signal_type: string;
  signal_strength?: string;
  title: string;
  description?: string;
  evidence_url?: string;
  metadata?: Record<string, unknown>;
  score_weight?: number;
};

function extractCompanyFromSalesNav(payload: Record<string, unknown>): CompanyFields | null {
  const name = String(payload.companyName || payload.company_name || payload.name || '').trim();
  if (!name) return null;
  return {
    name,
    domain: extractDomain(payload.website || payload.domain || payload.companyUrl),
    linkedin_url: String(payload.linkedinUrl || payload.linkedin_url || '').trim() || undefined,
    salesnav_account_id: String(payload.accountId || payload.account_id || payload.salesnavId || '').trim() || undefined,
    vertical: inferVertical(String(payload.industry || '')),
    employee_count: parseEmployeeCount(payload.employeeCount || payload.employee_count || payload.employees),
    employee_range: String(payload.employeeRange || payload.employee_range || '').trim() || undefined,
    hq_city: String(payload.city || payload.hq_city || '').trim() || undefined,
    hq_state: String(payload.state || payload.hq_state || '').trim() || undefined,
    hq_country: String(payload.country || payload.hq_country || 'US').trim(),
    description: String(payload.description || payload.about || '').trim() || undefined,
    source: 'salesnav',
    source_id: String(payload.accountId || payload.account_id || '').trim() || undefined,
  };
}

function extractCompanyFromCSV(payload: Record<string, unknown>): CompanyFields | null {
  const name = String(payload.company_name || payload.Company || payload.name || payload['Company Name'] || '').trim();
  if (!name) return null;
  return {
    name,
    domain: extractDomain(payload.website || payload.domain || payload.Website || payload.Domain),
    linkedin_url: String(payload.linkedin_url || payload.LinkedIn || '').trim() || undefined,
    vertical: String(payload.vertical || payload.industry || payload.Vertical || payload.Industry || '').trim() || undefined,
    employee_count: parseEmployeeCount(payload.employees || payload.employee_count || payload.Employees),
    employee_range: String(payload.employee_range || payload['Employee Range'] || '').trim() || undefined,
    hq_city: String(payload.city || payload.City || '').trim() || undefined,
    hq_state: String(payload.state || payload.State || '').trim() || undefined,
    hq_country: String(payload.country || payload.Country || 'US').trim(),
    description: String(payload.description || payload.Description || '').trim() || undefined,
    estimated_revenue: String(payload.revenue || payload.Revenue || '').trim() || undefined,
    source: 'csv',
    source_id: String(payload.id || payload.ID || '').trim() || undefined,
  };
}

function extractCompanyFromCrunchbase(payload: Record<string, unknown>): CompanyFields | null {
  const name = String(payload.name || payload.organization_name || '').trim();
  if (!name) return null;
  const funding = payload.funding_rounds as Array<Record<string, unknown>> | undefined;
  const lastRound = Array.isArray(funding) && funding.length > 0 ? funding[0] : null;
  return {
    name,
    domain: extractDomain(payload.homepage_url || payload.domain),
    vertical: inferVertical(String(payload.category_list || payload.industry || '')),
    employee_count: parseEmployeeCount(payload.num_employees_enum || payload.employee_count),
    hq_city: String(payload.city || '').trim() || undefined,
    hq_state: String(payload.region || '').trim() || undefined,
    hq_country: String(payload.country_code || 'US').trim(),
    description: String(payload.short_description || '').trim() || undefined,
    total_funding: parseAmount(payload.total_funding_usd || payload.total_funding),
    last_funding_amount: lastRound ? parseAmount(lastRound.money_raised_usd) : undefined,
    last_funding_round: lastRound ? String(lastRound.funding_type || '').trim() : undefined,
    last_funding_date: lastRound ? String(lastRound.announced_on || '').trim() : undefined,
    source: 'crunchbase',
    source_id: String(payload.uuid || payload.permalink || '').trim() || undefined,
  };
}

function extractCompanyFromAppStore(payload: Record<string, unknown>): Partial<CompanyFields> {
  return {
    has_mobile_app: true,
    app_store_url: String(payload.app_store_url || payload.trackViewUrl || '').trim() || undefined,
    play_store_url: String(payload.play_store_url || '').trim() || undefined,
    app_rating: parseFloat(String(payload.averageUserRating || payload.rating || '0')) || undefined,
    app_review_count: parseInt(String(payload.userRatingCount || payload.review_count || '0'), 10) || undefined,
    source: 'appstore',
  };
}

function extractContactFromSalesNav(payload: Record<string, unknown>): ContactFields | null {
  const fullName = String(payload.fullName || payload.full_name || payload.name || '').trim();
  if (!fullName) return null;
  return {
    full_name: fullName,
    first_name: String(payload.firstName || payload.first_name || '').trim() || undefined,
    last_name: String(payload.lastName || payload.last_name || '').trim() || undefined,
    email: normalizeEmail(payload.email),
    linkedin_url: String(payload.linkedinUrl || payload.linkedin_url || payload.profileUrl || '').trim() || undefined,
    salesnav_lead_id: String(payload.leadId || payload.lead_id || '').trim() || undefined,
    title: String(payload.title || payload.jobTitle || '').trim() || undefined,
    seniority: inferSeniority(String(payload.title || payload.jobTitle || '')),
    department: inferDepartment(String(payload.title || payload.jobTitle || '')),
    company_name: String(payload.companyName || payload.company_name || payload.company || '').trim() || undefined,
    source: 'salesnav',
    source_id: String(payload.leadId || payload.lead_id || '').trim() || undefined,
  };
}

function extractContactFromCSV(payload: Record<string, unknown>): ContactFields | null {
  const fullName = String(
    payload.full_name ||
    payload.name ||
    payload.Name ||
    `${payload.first_name || payload['First Name'] || ''} ${payload.last_name || payload['Last Name'] || ''}`.trim()
  ).trim();
  if (!fullName) return null;
  return {
    full_name: fullName,
    first_name: String(payload.first_name || payload['First Name'] || '').trim() || undefined,
    last_name: String(payload.last_name || payload['Last Name'] || '').trim() || undefined,
    email: normalizeEmail(payload.email || payload.Email),
    phone: String(payload.phone || payload.Phone || '').trim() || undefined,
    linkedin_url: String(payload.linkedin_url || payload.LinkedIn || '').trim() || undefined,
    title: String(payload.title || payload.Title || payload['Job Title'] || '').trim() || undefined,
    seniority: inferSeniority(String(payload.title || payload.Title || '')),
    department: inferDepartment(String(payload.title || payload.Title || '')),
    company_name: String(payload.company || payload.Company || payload.company_name || '').trim() || undefined,
    company_domain: extractDomain(payload.company_domain || payload.website),
    source: 'csv',
    source_id: String(payload.id || payload.ID || '').trim() || undefined,
  };
}

function extractSignalFromFunding(payload: Record<string, unknown>): SignalFields | null {
  const amount = parseAmount(payload.amount || payload.money_raised_usd);
  const round = String(payload.funding_type || payload.round || payload.series || '').trim();
  if (!amount && !round) return null;
  return {
    company_name: String(payload.company_name || payload.organization_name || '').trim() || undefined,
    company_domain: extractDomain(payload.company_domain || payload.homepage_url),
    signal_type: 'funding_round',
    signal_strength: amount && amount >= 10_000_000 ? 'strong' : amount && amount >= 1_000_000 ? 'medium' : 'weak',
    title: `Raised ${formatAmount(amount)} ${round}`.trim(),
    description: String(payload.description || '').trim() || undefined,
    evidence_url: String(payload.url || payload.cb_url || '').trim() || undefined,
    metadata: { amount, round, investors: payload.investors },
    score_weight: amount && amount >= 10_000_000 ? 25 : 15,
  };
}

function extractSignalFromJobPosting(payload: Record<string, unknown>): SignalFields | null {
  const jobTitle = String(payload.title || payload.job_title || '').trim();
  if (!jobTitle) return null;
  const isDev = /developer|engineer|ios|android|mobile|frontend|backend|full.?stack/i.test(jobTitle);
  const isProduct = /product.?manager|product.?owner|head of product/i.test(jobTitle);
  return {
    company_name: String(payload.company_name || payload.company || '').trim() || undefined,
    company_domain: extractDomain(payload.company_domain),
    signal_type: isDev ? 'hiring_developers' : isProduct ? 'hiring_product' : 'expansion_signal',
    signal_strength: isDev ? 'strong' : 'medium',
    title: `Hiring: ${jobTitle}`,
    description: String(payload.description || '').trim()?.slice(0, 500) || undefined,
    evidence_url: String(payload.url || payload.posting_url || '').trim() || undefined,
    metadata: { job_title: jobTitle, location: payload.location, salary_range: payload.salary },
    score_weight: isDev ? 20 : 15,
  };
}

function extractSignalFromAppReview(payload: Record<string, unknown>): SignalFields | null {
  const rating = parseFloat(String(payload.averageUserRating || payload.rating || '0'));
  if (!rating || rating >= 3.5) return null;
  return {
    company_name: String(payload.company_name || payload.sellerName || '').trim() || undefined,
    signal_type: 'bad_app_reviews',
    signal_strength: rating < 2.5 ? 'strong' : 'medium',
    title: `App rated ${rating.toFixed(1)} stars (${payload.userRatingCount || 0} reviews)`,
    evidence_url: String(payload.trackViewUrl || payload.app_url || '').trim() || undefined,
    metadata: { rating, review_count: payload.userRatingCount, common_complaints: payload.common_complaints },
    score_weight: rating < 2.5 ? 20 : 12,
  };
}

function extractDomain(value: unknown): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return cleaned.includes('.') ? cleaned : undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const cleaned = value.trim().toLowerCase();
  return cleaned.includes('@') ? cleaned : undefined;
}

function parseEmployeeCount(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (!value) return undefined;
  const str = String(value).replace(/,/g, '').trim();
  const rangeMatch = str.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) return Math.round((parseInt(rangeMatch[1], 10) + parseInt(rangeMatch[2], 10)) / 2);
  const num = parseInt(str, 10);
  return isNaN(num) ? undefined : num;
}

function parseAmount(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (!value) return undefined;
  const num = parseFloat(String(value).replace(/[$,]/g, '').trim());
  return isNaN(num) ? undefined : num;
}

function formatAmount(amount: number | undefined): string {
  if (!amount) return '';
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
}

function inferSeniority(title: string): string {
  const t = title.toLowerCase();
  if (/\b(ceo|cto|cfo|coo|cio|cpo|founder|co-founder|chief)\b/.test(t)) return 'c_suite';
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return 'vp';
  if (/\bdirector\b/.test(t)) return 'director';
  if (/\b(manager|lead|head)\b/.test(t)) return 'manager';
  return 'individual';
}

function inferDepartment(title: string): string {
  const t = title.toLowerCase();
  if (/\b(engineer|developer|devops|architect|sre|technical|software|mobile|ios|android|frontend|backend|full.?stack|cto)\b/.test(t)) return 'engineering';
  if (/\b(product|pm|ux|design)\b/.test(t)) return 'product';
  if (/\b(ceo|coo|founder|president|general manager)\b/.test(t)) return 'executive';
  if (/\b(marketing|growth|brand|content)\b/.test(t)) return 'marketing';
  if (/\b(sales|business development|account|bd)\b/.test(t)) return 'sales';
  if (/\b(operations|ops|admin)\b/.test(t)) return 'operations';
  if (/\b(finance|cfo|accounting)\b/.test(t)) return 'finance';
  return 'other';
}

function inferVertical(industry: string): string | undefined {
  const i = industry.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/health|medical|biotech|pharma|telemedicine|telehealth/, 'Healthcare'],
    [/fintech|financial|banking|insurance|neobank|payments/, 'Fintech'],
    [/logistics|supply chain|shipping|freight|transportation/, 'Logistics'],
    [/construction|building|architecture|real estate/, 'Construction'],
    [/retail|e-?commerce|consumer|shopping/, 'Retail'],
    [/education|edtech|learning|training/, 'Education'],
    [/manufacturing|industrial/, 'Manufacturing'],
    [/media|entertainment|gaming/, 'Media'],
    [/food|restaurant|hospitality|travel/, 'Hospitality'],
    [/energy|cleantech|solar|renewable/, 'Energy'],
    [/legal|law/, 'Legal'],
    [/automotive|car|vehicle/, 'Automotive'],
    [/software|saas|technology|it services/, 'Software'],
    [/government|public sector/, 'Government'],
    [/nonprofit|ngo/, 'Nonprofit'],
  ];
  for (const [pattern, vertical] of map) {
    if (pattern.test(i)) return vertical;
  }
  return undefined;
}

function companySize(count: number | undefined): string | undefined {
  if (!count) return undefined;
  if (count <= 10) return 'startup';
  if (count <= 200) return 'smb';
  if (count <= 1000) return 'mid_market';
  return 'enterprise';
}

function extractCompanyBySource(source: string, payload: Record<string, unknown>): CompanyFields | null {
  switch (source) {
    case 'salesnav': return extractCompanyFromSalesNav(payload);
    case 'csv': return extractCompanyFromCSV(payload);
    case 'crunchbase': return extractCompanyFromCrunchbase(payload);
    default: return extractCompanyFromCSV(payload);
  }
}

function extractContactBySource(source: string, payload: Record<string, unknown>): ContactFields | null {
  switch (source) {
    case 'salesnav': return extractContactFromSalesNav(payload);
    case 'csv': return extractContactFromCSV(payload);
    default: return extractContactFromCSV(payload);
  }
}

async function upsertCompany(pool: Pool, fields: CompanyFields): Promise<number> {
  const size = companySize(fields.employee_count);
  const { rows: existing } = await pool.query(
    `SELECT id FROM companies WHERE 
      (domain IS NOT NULL AND domain = $1) OR
      (salesnav_account_id IS NOT NULL AND salesnav_account_id = $2) OR
      (LOWER(name) = LOWER($3) AND domain IS NULL)
    LIMIT 1`,
    [fields.domain || '', fields.salesnav_account_id || '', fields.name]
  );

  if (existing.length > 0) {
    await pool.query(
      `UPDATE companies SET
        domain = COALESCE(domain, $2),
        linkedin_url = COALESCE(linkedin_url, $3),
        salesnav_account_id = COALESCE(salesnav_account_id, $4),
        vertical = COALESCE(vertical, $5),
        employee_count = COALESCE(employee_count, $6),
        employee_range = COALESCE(employee_range, $7),
        hq_city = COALESCE(hq_city, $8),
        hq_state = COALESCE(hq_state, $9),
        hq_country = COALESCE(hq_country, $10),
        description = COALESCE(description, $11),
        company_size = COALESCE(company_size, $12),
        estimated_revenue = COALESCE(estimated_revenue, $13),
        total_funding = COALESCE(total_funding, $14),
        last_funding_amount = COALESCE(last_funding_amount, $15),
        last_funding_round = COALESCE(last_funding_round, $16),
        updated_at = NOW()
      WHERE id = $1`,
      [
        existing[0].id, fields.domain, fields.linkedin_url, fields.salesnav_account_id,
        fields.vertical, fields.employee_count, fields.employee_range,
        fields.hq_city, fields.hq_state, fields.hq_country, fields.description,
        size, fields.estimated_revenue, fields.total_funding,
        fields.last_funding_amount, fields.last_funding_round,
      ]
    );
    return existing[0].id;
  }

  const { rows } = await pool.query(
    `INSERT INTO companies (name, domain, linkedin_url, salesnav_account_id, vertical, employee_count, employee_range,
      hq_city, hq_state, hq_country, description, company_size, estimated_revenue, total_funding,
      last_funding_amount, last_funding_round, last_funding_date, source, source_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    RETURNING id`,
    [
      fields.name, fields.domain, fields.linkedin_url, fields.salesnav_account_id,
      fields.vertical, fields.employee_count, fields.employee_range,
      fields.hq_city, fields.hq_state, fields.hq_country, fields.description,
      size, fields.estimated_revenue, fields.total_funding,
      fields.last_funding_amount, fields.last_funding_round, fields.last_funding_date,
      fields.source, fields.source_id,
    ]
  );
  return rows[0].id as number;
}

async function upsertContact(pool: Pool, fields: ContactFields): Promise<number> {
  let companyId: number | null = null;
  if (fields.company_domain || fields.company_name) {
    const { rows } = await pool.query(
      `SELECT id FROM companies WHERE
        (domain IS NOT NULL AND domain = $1) OR
        (LOWER(name) = LOWER($2))
      LIMIT 1`,
      [fields.company_domain || '', fields.company_name || '']
    );
    companyId = (rows[0]?.id as number | undefined) || null;
  }

  const isDecisionMaker = fields.seniority ? ['c_suite', 'vp', 'director'].includes(fields.seniority) : false;

  const { rows: existing } = await pool.query(
    `SELECT id FROM contacts WHERE
      (email IS NOT NULL AND email = $1) OR
      (linkedin_url IS NOT NULL AND linkedin_url = $2) OR
      (salesnav_lead_id IS NOT NULL AND salesnav_lead_id = $3)
    LIMIT 1`,
    [fields.email || '', fields.linkedin_url || '', fields.salesnav_lead_id || '']
  );

  if (existing.length > 0) {
    await pool.query(
      `UPDATE contacts SET
        company_id = COALESCE($2, company_id),
        email = COALESCE(email, $3),
        phone = COALESCE(phone, $4),
        linkedin_url = COALESCE(linkedin_url, $5),
        salesnav_lead_id = COALESCE(salesnav_lead_id, $6),
        title = COALESCE($7, title),
        seniority = COALESCE($8, seniority),
        department = COALESCE($9, department),
        is_decision_maker = $10 OR is_decision_maker,
        updated_at = NOW()
      WHERE id = $1`,
      [
        existing[0].id, companyId, fields.email, fields.phone,
        fields.linkedin_url, fields.salesnav_lead_id,
        fields.title, fields.seniority, fields.department, isDecisionMaker,
      ]
    );
    return existing[0].id as number;
  }

  const { rows } = await pool.query(
    `INSERT INTO contacts (company_id, full_name, first_name, last_name, email, phone,
      linkedin_url, salesnav_lead_id, title, seniority, department, is_decision_maker, source, source_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING id`,
    [
      companyId, fields.full_name, fields.first_name, fields.last_name,
      fields.email, fields.phone, fields.linkedin_url, fields.salesnav_lead_id,
      fields.title, fields.seniority, fields.department, isDecisionMaker,
      fields.source, fields.source_id,
    ]
  );
  return rows[0].id as number;
}

async function insertSignal(pool: Pool, signal: SignalFields, rawEventId: number): Promise<void> {
  let companyId: number | null = null;
  if (signal.company_domain || signal.company_name) {
    const { rows } = await pool.query(
      `SELECT id FROM companies WHERE
        (domain IS NOT NULL AND domain = $1) OR
        (LOWER(name) = LOWER($2))
      LIMIT 1`,
      [signal.company_domain || '', signal.company_name || '']
    );
    companyId = (rows[0]?.id as number | undefined) || null;
  }
  if (!companyId) return;

  const { rows: recent } = await pool.query(
    `SELECT id FROM signals WHERE company_id = $1 AND signal_type = $2 AND detected_at > NOW() - INTERVAL '7 days' LIMIT 1`,
    [companyId, signal.signal_type]
  );
  if (recent.length > 0) return;

  await pool.query(
    `INSERT INTO signals (company_id, raw_event_id, signal_type, signal_strength, title, description, evidence_url, metadata, score_weight)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      companyId, rawEventId, signal.signal_type, signal.signal_strength || 'medium',
      signal.title, signal.description, signal.evidence_url,
      JSON.stringify(signal.metadata || {}), signal.score_weight || 10,
    ]
  );
}

async function updateCompanyAppData(pool: Pool, payload: Record<string, unknown>, appData: Partial<CompanyFields>): Promise<void> {
  const domain = extractDomain(payload.company_domain || payload.sellerUrl);
  const name = String(payload.company_name || payload.sellerName || '').trim();
  if (!domain && !name) return;
  await pool.query(
    `UPDATE companies SET
      has_mobile_app = TRUE,
      app_store_url = COALESCE($3, app_store_url),
      play_store_url = COALESCE($4, play_store_url),
      app_rating = COALESCE($5, app_rating),
      app_review_count = COALESCE($6, app_review_count),
      updated_at = NOW()
    WHERE (domain IS NOT NULL AND domain = $1) OR (LOWER(name) = LOWER($2))`,
    [domain || '', name, appData.app_store_url, appData.play_store_url, appData.app_rating, appData.app_review_count]
  );
}

export async function normalizeRawEvents(config: NormalizerConfig): Promise<NormalizeResult> {
  const { pool, dryRun } = config;
  const result: NormalizeResult = { processed: 0, created: 0, updated: 0, skipped: 0, errors: [] };

  const { rows: events } = await pool.query(
    `SELECT id, source, event_type, payload FROM raw_events WHERE NOT normalized ORDER BY id LIMIT 1000`
  );

  for (const event of events) {
    try {
      result.processed++;
      const payload = event.payload as Record<string, unknown>;

      switch (event.event_type as string) {
        case 'company_discovered': {
          const fields = extractCompanyBySource(event.source as string, payload);
          if (!fields) { result.skipped++; break; }
          if (!dryRun) {
            await upsertCompany(pool, fields);
            result.created++;
          }
          break;
        }
        case 'contact_found': {
          const fields = extractContactBySource(event.source as string, payload);
          if (!fields) { result.skipped++; break; }
          if (!dryRun) {
            await upsertContact(pool, fields);
            result.created++;
          }
          break;
        }
        case 'funding_round': {
          const signal = extractSignalFromFunding(payload);
          if (!signal) { result.skipped++; break; }
          if (!dryRun) {
            await insertSignal(pool, signal, event.id as number);
            result.created++;
          }
          break;
        }
        case 'job_posting': {
          const signal = extractSignalFromJobPosting(payload);
          if (!signal) { result.skipped++; break; }
          if (!dryRun) {
            await insertSignal(pool, signal, event.id as number);
            result.created++;
          }
          break;
        }
        case 'app_review_data': {
          const appData = extractCompanyFromAppStore(payload);
          const signal = extractSignalFromAppReview(payload);
          if (!dryRun && appData) {
            await updateCompanyAppData(pool, payload, appData);
          }
          if (!dryRun && signal) {
            await insertSignal(pool, signal, event.id as number);
            result.created++;
          } else {
            result.skipped++;
          }
          break;
        }
        default:
          result.skipped++;
      }

      if (!dryRun) {
        await pool.query(`UPDATE raw_events SET normalized = TRUE, normalized_at = NOW() WHERE id = $1`, [event.id]);
      }
    } catch (err) {
      result.errors.push({ eventId: event.id as number, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
