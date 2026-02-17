import fs from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOG_DIR = path.resolve(process.cwd(), 'data');
const LOG_FILE = path.join(LOG_DIR, 'source_runs.jsonl');
const STATE_FILE = path.join(LOG_DIR, 'source_state.json');

type SourceRun = {
  source: string;
  query?: string;
  started_at: string;
  completed_at: string;
  ok: boolean;
  http_status?: number;
  collected?: number;
  saved?: number;
  message?: string;
  link?: string;
};

type SourceState = {
  last_salesnav_run_at?: string;
  next_salesnav_query_index?: number;
  next_company_index?: number;
  next_company_index_appstore?: number;
  next_company_index_playstore?: number;
  next_company_index_google_news?: number;
  next_company_index_crunchbase?: number;
  next_company_index_website?: number;
  next_company_index_jobs?: number;
};

type CompanyIndexStateKey =
  | 'next_company_index'
  | 'next_company_index_appstore'
  | 'next_company_index_playstore'
  | 'next_company_index_google_news'
  | 'next_company_index_crunchbase'
  | 'next_company_index_website'
  | 'next_company_index_jobs';

type TargetCompany = {
  id: number;
  company_name: string;
  domain?: string | null;
  vertical?: string | null;
  tier?: string | null;
  status?: string | null;
};

type SourceCycleStats = {
  source: string;
  attempted: number;
  ok: number;
  failed: number;
  collected: number;
  saved: number;
  skipped?: boolean;
  note?: string;
};

function emptyStats(source: string): SourceCycleStats {
  return { source, attempted: 0, ok: 0, failed: 0, collected: 0, saved: 0 };
}

function appendLog(entry: SourceRun): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function parseQueries(raw: string): string[] {
  return raw.split('|').map((x) => x.trim()).filter(Boolean);
}

function readState(): SourceState {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as SourceState;
  } catch {
    return {};
  }
}

function writeState(state: SourceState): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function rotateCompanies(companies: TargetCompany[], state: SourceState, maxCount: number, sourceKey: CompanyIndexStateKey): TargetCompany[] {
  if (companies.length === 0 || maxCount <= 0) return [];
  const current = Number(state[sourceKey] || 0);
  const start = Number.isFinite(current) ? current : 0;
  const out: TargetCompany[] = [];
  for (let i = 0; i < Math.min(maxCount, companies.length); i += 1) {
    out.push(companies[(start + i) % companies.length]);
  }
  state[sourceKey] = (start + out.length) % companies.length;
  return out;
}

function getTodaySalesnavCount(): number {
  if (!fs.existsSync(LOG_FILE)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  let count = 0;
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { source?: string; started_at?: string };
      if (row.source === 'salesnav' && String(row.started_at || '').startsWith(today)) {
        count += 1;
      }
    } catch {
      // ignore parse errors
    }
  }
  return count;
}

function normalizeTokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

const COMMON_TOKENS = new Set([
  'inc',
  'llc',
  'ltd',
  'co',
  'corp',
  'corporation',
  'company',
  'group',
  'the',
  'and',
]);

function meaningfulTokens(text: string): string[] {
  return normalizeTokens(text).filter((token) => token.length > 1 && !COMMON_TOKENS.has(token));
}

function tokenOverlapRatio(target: string[], candidate: string[]): { overlap: number; ratio: number } {
  if (target.length === 0 || candidate.length === 0) return { overlap: 0, ratio: 0 };
  const bag = new Set(candidate);
  const overlap = target.filter((x) => bag.has(x)).length;
  return { overlap, ratio: overlap / target.length };
}

function parseGoogleNewsItems(xml: string): Array<{ title: string; link: string; pubDate: string }> {
  const items: Array<{ title: string; link: string; pubDate: string }> = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks) {
    const title = (
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
      block.match(/<title>(.*?)<\/title>/)?.[1] ||
      ''
    ).trim();
    const link = (block.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '').trim();
    if (title || link) items.push({ title, link, pubDate });
  }
  return items;
}

function parsePlayStorePage(html: string): { appCount: number; appIds: string[]; topRating?: number } {
  const appIds = new Set<string>();
  const appMatches = html.match(/\/store\/apps\/details\?id=([a-zA-Z0-9._-]+)/g) || [];
  for (const m of appMatches) {
    const id = m.split('id=')[1];
    if (id) appIds.add(id);
  }

  let topRating: number | undefined;
  const ratingMatches = html.match(/Rated\s+([0-9](?:\.[0-9])?)\s+stars/gi) || [];
  for (const item of ratingMatches) {
    const n = Number(item.match(/([0-9](?:\.[0-9])?)/)?.[1] || 0);
    if (n > 0 && (topRating == null || n > topRating)) {
      topRating = n;
    }
  }

  return { appCount: appIds.size, appIds: [...appIds], topRating };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parsePlayStoreDetails(html: string): { appName?: string; developer?: string; rating?: number } {
  const scripts = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script
      .replace(/^<script type="application\/ld\+json">/i, '')
      .replace(/<\/script>$/i, '')
      .trim();
    if (!body) continue;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown> | Array<Record<string, unknown>>;
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (String(entry['@type'] || '').toLowerCase() !== 'softwareapplication') continue;
        const aggregate = (entry.aggregateRating || {}) as Record<string, unknown>;
        const ratingValue = Number(aggregate.ratingValue || 0) || undefined;
        const appName = String(entry.name || '').trim() || undefined;
        const author = (entry.author || {}) as Record<string, unknown>;
        const developer = String(author.name || '').trim() || undefined;
        return {
          appName: appName ? decodeHtmlEntities(appName) : undefined,
          developer: developer ? decodeHtmlEntities(developer) : undefined,
          rating: ratingValue,
        };
      }
    } catch {
      // ignore malformed embedded json
    }
  }
  return {};
}

async function fetchTargetCompanies(limit: number): Promise<TargetCompany[]> {
  const pythonBin = process.env.PYTHON_BIN || 'python';
  const dbPathRaw = process.env.BI_SQLITE_PATH || process.env.OUTREACH_DB_PATH || '../data/outreach.db';
  const dbPath = path.isAbsolute(dbPathRaw) ? dbPathRaw : path.resolve(process.cwd(), dbPathRaw);
  const script = `
import json, sqlite3, sys
db_path=sys.argv[1]
limit=int(sys.argv[2])
conn=sqlite3.connect(db_path)
conn.row_factory=sqlite3.Row
cur=conn.cursor()
cur.execute("SELECT id, company_name, domain, vertical, tier, status FROM targets WHERE company_name IS NOT NULL AND TRIM(company_name) != '' ORDER BY updated_at DESC LIMIT ?", (limit,))
rows=[dict(r) for r in cur.fetchall()]
conn.close()
print(json.dumps(rows))
`.trim();
  const { stdout } = await execFileAsync(pythonBin, ['-c', script, dbPath, String(limit)], { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout || '[]') as TargetCompany[];
}

async function runSalesNav(state: SourceState): Promise<SourceCycleStats> {
  const stats = emptyStats('salesnav');
  const enabled = (process.env.SALESNAV_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    stats.skipped = true;
    stats.note = 'disabled';
    return stats;
  }

  const safeMode = (process.env.SALESNAV_SAFE_MODE || 'true').toLowerCase() === 'true';
  const minIntervalMinutes = Number(process.env.SALESNAV_MIN_INTERVAL_MINUTES || '120');
  const maxQueriesPerCycle = Math.max(1, Number(process.env.SALESNAV_MAX_QUERIES_PER_CYCLE || '1'));
  const dailyMaxRequests = Math.max(1, Number(process.env.SALESNAV_DAILY_MAX_REQUESTS || '12'));
  const timeoutMs = Number(process.env.SALESNAV_REQUEST_TIMEOUT_MS || '90000');
  const interQueryDelayMs = Math.max(0, Number(process.env.SALESNAV_INTER_QUERY_DELAY_MS || '5000'));

  const queries = parseQueries(process.env.SALESNAV_QUERIES || '');
  if (queries.length === 0) {
    stats.skipped = true;
    stats.note = 'no_queries';
    return stats;
  }

  if (safeMode && state.last_salesnav_run_at) {
    const elapsedMs = Date.now() - new Date(state.last_salesnav_run_at).getTime();
    const requiredMs = minIntervalMinutes * 60 * 1000;
    if (elapsedMs < requiredMs) {
      const waitMin = Math.ceil((requiredMs - elapsedMs) / 60000);
      console.log(`[sqlite-bi][sources] salesnav throttled by interval; next in ~${waitMin} min`);
      stats.skipped = true;
      stats.note = `throttled_interval_${waitMin}m`;
      return stats;
    }
  }
  if (safeMode) {
    const usedToday = getTodaySalesnavCount();
    if (usedToday >= dailyMaxRequests) {
      console.log(`[sqlite-bi][sources] salesnav daily cap reached (${usedToday}/${dailyMaxRequests})`);
      stats.skipped = true;
      stats.note = `daily_cap_${usedToday}/${dailyMaxRequests}`;
      return stats;
    }
  }

  const url = process.env.SALESNAV_COLLECT_URL || 'http://localhost:8000/api/companies/collect';
  const maxCompanies = Number(process.env.SALESNAV_MAX_COMPANIES || '50');
  const startIdx = state.next_salesnav_query_index || 0;
  const selected: string[] = [];
  for (let i = 0; i < Math.min(maxQueriesPerCycle, queries.length); i += 1) {
    selected.push(queries[(startIdx + i) % queries.length]);
  }
  console.log(`[sqlite-bi][sources] salesnav start selected=${selected.length}/${queries.length}`);

  for (let i = 0; i < selected.length; i += 1) {
    stats.attempted += 1;
    const query = selected[i];
    const started = new Date().toISOString();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, max_companies: maxCompanies, save_to_db: true }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const completed = new Date().toISOString();
      if (!response.ok) {
        stats.failed += 1;
        appendLog({
          source: 'salesnav',
          query,
          started_at: started,
          completed_at: completed,
          ok: false,
          http_status: response.status,
          message: `HTTP ${response.status}`,
        });
      } else {
        const payload = (await response.json()) as { companies?: Array<Record<string, unknown>>; saved_count?: number; status?: string };
        stats.ok += 1;
        stats.collected += (payload.companies || []).length;
        stats.saved += Number(payload.saved_count || 0);
        appendLog({
          source: 'salesnav',
          query,
          started_at: started,
          completed_at: completed,
          ok: true,
          http_status: response.status,
          collected: (payload.companies || []).length,
          saved: Number(payload.saved_count || 0),
          message: payload.status || 'ok',
        });
      }
    } catch (err) {
      stats.failed += 1;
      const completed = new Date().toISOString();
      appendLog({
        source: 'salesnav',
        query,
        started_at: started,
        completed_at: completed,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (interQueryDelayMs > 0 && i < selected.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, interQueryDelayMs));
    }
  }
  state.last_salesnav_run_at = new Date().toISOString();
  state.next_salesnav_query_index = (startIdx + selected.length) % queries.length;
  return stats;
}

async function runAppStore(companies: TargetCompany[]): Promise<SourceCycleStats> {
  const stats = emptyStats('appstore');
  const enabled = (process.env.APPSTORE_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    stats.skipped = true;
    stats.note = 'disabled';
    return stats;
  }
  const minRatio = Number(process.env.APPSTORE_MIN_NAME_OVERLAP_RATIO || '0.5');
  for (const company of companies) {
    stats.attempted += 1;
    const started = new Date().toISOString();
    try {
      const term = encodeURIComponent(company.company_name);
      const response = await fetch(`https://itunes.apple.com/search?term=${term}&entity=software&limit=5`);
      const completed = new Date().toISOString();
      if (!response.ok) {
        stats.failed += 1;
        appendLog({ source: 'appstore', query: company.company_name, started_at: started, completed_at: completed, ok: false, http_status: response.status, message: `HTTP ${response.status}` });
        continue;
      }
      const payload = (await response.json()) as { results?: Array<Record<string, unknown>> };
      const results = payload.results || [];
      stats.ok += 1;
      stats.collected += results.length;
      const nameTokens = meaningfulTokens(company.company_name);
      const best = results
        .map((app) => {
          const sellerStats = tokenOverlapRatio(nameTokens, meaningfulTokens(String(app.sellerName || '')));
          const titleStats = tokenOverlapRatio(nameTokens, meaningfulTokens(String(app.trackName || app.trackCensoredName || '')));
          const overlap = Math.max(sellerStats.overlap, titleStats.overlap);
          const ratio = Math.max(sellerStats.ratio, titleStats.ratio);
          return { app, overlap, ratio };
        })
        .sort((a, b) => b.ratio - a.ratio || b.overlap - a.overlap)[0];
      if (!best || best.overlap < 1 || best.ratio < minRatio) {
        appendLog({ source: 'appstore', query: company.company_name, started_at: started, completed_at: completed, ok: true, collected: 0, saved: 0, message: 'no_match' });
        continue;
      }
      stats.saved += 1;
      appendLog({
        source: 'appstore',
        query: company.company_name,
        started_at: started,
        completed_at: completed,
        ok: true,
        collected: results.length,
        saved: 1,
        message: `match app=${String(best.app.trackName || best.app.trackCensoredName || '')} seller=${String(best.app.sellerName || '')} rating=${String(best.app.averageUserRating || '')}`,
        link: String(best.app.trackViewUrl || '').trim() || undefined,
      });
    } catch (err) {
      stats.failed += 1;
      const completed = new Date().toISOString();
      appendLog({ source: 'appstore', query: company.company_name, started_at: started, completed_at: completed, ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return stats;
}

async function runPlayStore(companies: TargetCompany[]): Promise<SourceCycleStats> {
  const stats = emptyStats('playstore');
  const enabled = (process.env.PLAYSTORE_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    stats.skipped = true;
    stats.note = 'disabled';
    return stats;
  }
  const minRatio = Number(process.env.PLAYSTORE_MIN_NAME_OVERLAP_RATIO || '0.5');
  const detailFetchLimit = Math.max(1, Number(process.env.PLAYSTORE_DETAIL_FETCH_LIMIT || '5'));
  for (const company of companies) {
    stats.attempted += 1;
    const started = new Date().toISOString();
    try {
      const query = encodeURIComponent(company.company_name);
      const searchUrl = `https://play.google.com/store/search?q=${query}&c=apps&hl=en_US&gl=US`;
      const response = await fetch(searchUrl);
      const completed = new Date().toISOString();
      if (!response.ok) {
        stats.failed += 1;
        appendLog({ source: 'playstore', query: company.company_name, started_at: started, completed_at: completed, ok: false, http_status: response.status, message: `HTTP ${response.status}` });
        continue;
      }
      const html = await response.text();
      const parsed = parsePlayStorePage(html);
      const companyTokens = meaningfulTokens(company.company_name);
      const candidates: Array<{ appId: string; appName?: string; developer?: string; rating?: number; overlap: number; ratio: number; url: string }> = [];
      for (const appId of parsed.appIds.slice(0, detailFetchLimit)) {
        const detailUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=en_US&gl=US`;
        try {
          const detailResp = await fetch(detailUrl);
          if (!detailResp.ok) continue;
          const detailHtml = await detailResp.text();
          const detail = parsePlayStoreDetails(detailHtml);
          const devStats = tokenOverlapRatio(companyTokens, meaningfulTokens(detail.developer || ''));
          const appStats = tokenOverlapRatio(companyTokens, meaningfulTokens(detail.appName || ''));
          candidates.push({
            appId,
            appName: detail.appName,
            developer: detail.developer,
            rating: detail.rating,
            overlap: Math.max(devStats.overlap, appStats.overlap),
            ratio: Math.max(devStats.ratio, appStats.ratio),
            url: detailUrl,
          });
        } catch {
          // ignore per-candidate detail fetch errors
        }
      }
      const best = candidates.sort((a, b) => b.ratio - a.ratio || b.overlap - a.overlap)[0];
      const topRatingFromDetails = candidates.reduce<number | undefined>((acc, cur) => {
        if (cur.rating == null) return acc;
        if (acc == null || cur.rating > acc) return cur.rating;
        return acc;
      }, undefined);
      const match = !!best && best.overlap >= 1 && best.ratio >= minRatio;
      stats.ok += 1;
      stats.collected += parsed.appCount;
      if (match) stats.saved += 1;
      appendLog({
        source: 'playstore',
        query: company.company_name,
        started_at: started,
        completed_at: completed,
        ok: true,
        collected: parsed.appCount,
        saved: match ? 1 : 0,
        message: match
          ? `match app=${best.appName || best.appId} developer=${best.developer || ''} rating=${best.rating ?? ''} apps=${parsed.appCount}`
          : ((topRatingFromDetails ?? parsed.topRating) != null
            ? `apps=${parsed.appCount} top_rating=${topRatingFromDetails ?? parsed.topRating}`
            : `apps=${parsed.appCount}`),
        link: match ? best.url : searchUrl,
      });
    } catch (err) {
      stats.failed += 1;
      const completed = new Date().toISOString();
      appendLog({ source: 'playstore', query: company.company_name, started_at: started, completed_at: completed, ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return stats;
}

async function runGoogleNews(companies: TargetCompany[]): Promise<SourceCycleStats> {
  const stats = emptyStats('google_news');
  const enabled = (process.env.GOOGLE_NEWS_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    stats.skipped = true;
    stats.note = 'disabled';
    return stats;
  }
  for (const company of companies) {
    stats.attempted += 1;
    const started = new Date().toISOString();
    try {
      const query = encodeURIComponent(`"${company.company_name}" funding OR hiring OR mobile app`);
      const response = await fetch(`https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`);
      const completed = new Date().toISOString();
      if (!response.ok) {
        stats.failed += 1;
        appendLog({ source: 'google_news', query: company.company_name, started_at: started, completed_at: completed, ok: false, http_status: response.status, message: `HTTP ${response.status}` });
        continue;
      }
      const xml = await response.text();
      const items = parseGoogleNewsItems(xml);
      stats.ok += 1;
      stats.collected += items.length;
      if (items.length > 0) stats.saved += 1;
      appendLog({
        source: 'google_news',
        query: company.company_name,
        started_at: started,
        completed_at: completed,
        ok: true,
        collected: items.length,
        saved: items.length > 0 ? 1 : 0,
        message: items[0]?.title || 'no_items',
        link: items[0]?.link || undefined,
      });
    } catch (err) {
      stats.failed += 1;
      const completed = new Date().toISOString();
      appendLog({ source: 'google_news', query: company.company_name, started_at: started, completed_at: completed, ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return stats;
}

async function runCrunchbase(companies: TargetCompany[]): Promise<SourceCycleStats> {
  const stats = emptyStats('crunchbase');
  const enabled = (process.env.CRUNCHBASE_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    stats.skipped = true;
    stats.note = 'disabled';
    return stats;
  }
  const apiKey = process.env.CRUNCHBASE_API_KEY || '';
  if (!apiKey) {
    stats.skipped = true;
    stats.note = 'missing_api_key';
    return stats;
  }
  const template = process.env.CRUNCHBASE_ORG_URL_TEMPLATE || 'https://api.crunchbase.com/api/v4/entities/organizations/{org}';
  for (const company of companies) {
    stats.attempted += 1;
    const started = new Date().toISOString();
    try {
      const key = (company.domain || company.company_name).replace(/^www\./, '').toLowerCase();
      const org = key.split('.')[0];
      const url = template.replace('{org}', encodeURIComponent(org));
      const response = await fetch(url, { headers: { 'X-cb-user-key': apiKey, Accept: 'application/json' } });
      const completed = new Date().toISOString();
      if (!response.ok) {
        stats.failed += 1;
        appendLog({ source: 'crunchbase', query: company.company_name, started_at: started, completed_at: completed, ok: false, http_status: response.status, message: `HTTP ${response.status}` });
        continue;
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const props = (payload.properties || {}) as Record<string, unknown>;
      const funding = props.total_funding_usd || props.last_funding_type || props.last_funding_at;
      stats.ok += 1;
      stats.collected += 1;
      if (funding) stats.saved += 1;
      appendLog({
        source: 'crunchbase',
        query: company.company_name,
        started_at: started,
        completed_at: completed,
        ok: true,
        collected: 1,
        saved: funding ? 1 : 0,
        message: funding ? `funding_signal ${String(props.last_funding_type || '')}` : 'no_funding_signal',
      });
    } catch (err) {
      stats.failed += 1;
      const completed = new Date().toISOString();
      appendLog({ source: 'crunchbase', query: company.company_name, started_at: started, completed_at: completed, ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return stats;
}

async function runWebsiteSignals(companies: TargetCompany[]): Promise<SourceCycleStats> {
  const stats = emptyStats('website');
  const enabled = (process.env.WEBSITE_SIGNALS_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    stats.skipped = true;
    stats.note = 'disabled';
    return stats;
  }
  for (const company of companies) {
    stats.attempted += 1;
    const started = new Date().toISOString();
    const domain = (company.domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain) {
      const completed = new Date().toISOString();
      appendLog({ source: 'website', query: company.company_name, started_at: started, completed_at: completed, ok: true, collected: 0, saved: 0, message: 'no_domain' });
      stats.ok += 1;
      continue;
    }
    try {
      const baseUrl = `https://${domain}`;
      const [home, careers] = await Promise.all([
        fetch(baseUrl, { redirect: 'follow' }),
        fetch(`${baseUrl}/careers`, { redirect: 'follow' }),
      ]);
      const completed = new Date().toISOString();
      if (!home.ok && !careers.ok) {
        stats.failed += 1;
        appendLog({ source: 'website', query: company.company_name, started_at: started, completed_at: completed, ok: false, message: `home=${home.status} careers=${careers.status}` });
        continue;
      }
      const homeText = home.ok ? (await home.text()).slice(0, 25000).toLowerCase() : '';
      const careersText = careers.ok ? (await careers.text()).slice(0, 25000).toLowerCase() : '';
      const combined = `${homeText}\n${careersText}`;

      const hasMobile = /(ios|android|mobile app|app store|google play|react native|flutter)/.test(combined);
      const hasHiring = /(careers|jobs|we are hiring|open roles|engineering roles|software engineer|mobile engineer|ios developer|android developer)/.test(combined);

      const saved = hasMobile || hasHiring ? 1 : 0;
      stats.ok += 1;
      stats.collected += Number(home.ok) + Number(careers.ok);
      stats.saved += saved;
      appendLog({
        source: 'website',
        query: company.company_name,
        started_at: started,
        completed_at: completed,
        ok: true,
        collected: Number(home.ok) + Number(careers.ok),
        saved,
        message: `mobile=${hasMobile ? 'yes' : 'no'} hiring=${hasHiring ? 'yes' : 'no'} domain=${domain}`,
      });
    } catch (err) {
      stats.failed += 1;
      const completed = new Date().toISOString();
      appendLog({ source: 'website', query: company.company_name, started_at: started, completed_at: completed, ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return stats;
}

async function runJobPostings(companies: TargetCompany[]): Promise<SourceCycleStats> {
  const stats = emptyStats('job_postings');
  const enabled = (process.env.JOB_POSTINGS_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    stats.skipped = true;
    stats.note = 'disabled';
    return stats;
  }
  const url = process.env.JOB_POSTINGS_COLLECT_URL || '';
  if (!url) {
    stats.skipped = true;
    stats.note = 'missing_collect_url';
    return stats;
  }

  const timeoutMs = Number(process.env.JOB_POSTINGS_TIMEOUT_MS || '60000');
  const maxJobs = Math.max(1, Number(process.env.JOB_POSTINGS_MAX_RESULTS || '20'));

  for (const company of companies) {
    stats.attempted += 1;
    const started = new Date().toISOString();
    try {
      const query = `"${company.company_name}" (ios OR android OR "mobile engineer" OR "software engineer" OR "product manager")`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, max_results: maxJobs, company_name: company.company_name }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const completed = new Date().toISOString();
      if (!response.ok) {
        stats.failed += 1;
        appendLog({ source: 'job_postings', query: company.company_name, started_at: started, completed_at: completed, ok: false, http_status: response.status, message: `HTTP ${response.status}` });
        continue;
      }
      const payload = (await response.json()) as { jobs?: Array<Record<string, unknown>>; saved_count?: number; status?: string };
      const jobs = payload.jobs || [];
      stats.ok += 1;
      stats.collected += jobs.length;
      stats.saved += Number(payload.saved_count || (jobs.length > 0 ? 1 : 0));
      const firstTitle = String((jobs[0]?.title as string) || '').slice(0, 120);
      appendLog({
        source: 'job_postings',
        query: company.company_name,
        started_at: started,
        completed_at: completed,
        ok: true,
        collected: jobs.length,
        saved: Number(payload.saved_count || (jobs.length > 0 ? 1 : 0)),
        message: firstTitle ? `top_job=${firstTitle}` : (payload.status || 'ok'),
      });
    } catch (err) {
      stats.failed += 1;
      const completed = new Date().toISOString();
      appendLog({ source: 'job_postings', query: company.company_name, started_at: started, completed_at: completed, ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return stats;
}

export function getSourceRunLogPath(): string {
  return LOG_FILE;
}

export async function runSqliteSourceCollection(): Promise<void> {
  const state = readState();
  const salesnavStats = await runSalesNav(state);

  const companyPoolLimit = Math.max(1, Number(process.env.BI_SOURCE_COMPANY_POOL_LIMIT || '200'));
  const companies = await fetchTargetCompanies(companyPoolLimit);

  const appstoreMax = Math.max(0, Number(process.env.APPSTORE_MAX_COMPANIES_PER_CYCLE || '5'));
  const playstoreMax = Math.max(0, Number(process.env.PLAYSTORE_MAX_COMPANIES_PER_CYCLE || '5'));
  const newsMax = Math.max(0, Number(process.env.GOOGLE_NEWS_MAX_COMPANIES_PER_CYCLE || '5'));
  const cbMax = Math.max(0, Number(process.env.CRUNCHBASE_MAX_COMPANIES_PER_CYCLE || '5'));
  const websiteMax = Math.max(0, Number(process.env.WEBSITE_SIGNALS_MAX_COMPANIES_PER_CYCLE || '5'));
  const jobsMax = Math.max(0, Number(process.env.JOB_POSTINGS_MAX_COMPANIES_PER_CYCLE || '5'));

  const stats: SourceCycleStats[] = [salesnavStats];
  stats.push(await runAppStore(rotateCompanies(companies, state, appstoreMax, 'next_company_index_appstore')));
  stats.push(await runPlayStore(rotateCompanies(companies, state, playstoreMax, 'next_company_index_playstore')));
  stats.push(await runGoogleNews(rotateCompanies(companies, state, newsMax, 'next_company_index_google_news')));
  stats.push(await runCrunchbase(rotateCompanies(companies, state, cbMax, 'next_company_index_crunchbase')));
  stats.push(await runWebsiteSignals(rotateCompanies(companies, state, websiteMax, 'next_company_index_website')));
  stats.push(await runJobPostings(rotateCompanies(companies, state, jobsMax, 'next_company_index_jobs')));

  writeState(state);

  const printable = stats
    .filter((s) => s.attempted > 0 || s.saved > 0 || s.note)
    .map((s) => {
      const base = `${s.source}: attempted=${s.attempted} ok=${s.ok} failed=${s.failed} collected=${s.collected} saved=${s.saved}`;
      return s.note ? `${base} note=${s.note}` : base;
    });
  if (printable.length > 0) {
    console.log(`[sqlite-bi][sources] ${printable.join(' | ')}`);
  }
}
