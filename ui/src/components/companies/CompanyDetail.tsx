import { Building2, Globe, Target, FileText } from 'lucide-react';
import { Newspaper, Smartphone, BriefcaseBusiness, Store } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Company } from '../../api';
import { api } from '../../api';
import { TierBadge } from './TierBadge';
import { StatusBadge } from './StatusBadge';

type CompanyDetailProps = {
  company: Company;
};

export function CompanyDetail({ company }: CompanyDetailProps) {
  const [showBiDetails, setShowBiDetails] = useState(false);
  const biQuery = useQuery({
    queryKey: ['company-bi-profile', company.id],
    queryFn: () => api.getCompanyBiProfile(Number(company.id)),
    enabled: Number.isFinite(Number(company.id)),
    staleTime: 30000,
  });
  const bi = biQuery.data;
  const sourceLinks = bi?.source_links ?? [];
  const collectionLogs = bi?.collection_logs ?? [];
  const topSignals = bi?.signals?.slice(0, 3) ?? [];
  const topAppEvidence = bi?.app_evidence?.slice(0, 2) ?? [];

  const fmtDate = (value?: string) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString();
  };

  const sourceIcon = (source?: string) => {
    const s = String(source || '').toLowerCase();
    if (s === 'google_news') return <Newspaper className="w-3 h-3" />;
    if (s === 'playstore' || s === 'appstore') return <Smartphone className="w-3 h-3" />;
    if (s === 'website') return <Globe className="w-3 h-3" />;
    if (s === 'salesnav') return <BriefcaseBusiness className="w-3 h-3" />;
    return <Store className="w-3 h-3" />;
  };

  const sourceQuality = useMemo(() => {
    const map = new Map<string, 'good' | 'weak' | 'none'>();
    for (const log of collectionLogs) {
      const source = String(log.source || '').toLowerCase();
      if (!source || map.has(source)) continue;
      const message = String(log.message || '').toLowerCase();
      const ok = Boolean(log.ok);
      const saved = Number(log.saved || 0);
      const collected = Number(log.collected || 0);
      if (!ok) {
        map.set(source, 'none');
        continue;
      }
      if (saved > 0 && (message.includes('match') || source === 'google_news')) {
        map.set(source, 'good');
        continue;
      }
      if (saved > 0 || collected > 0) {
        map.set(source, 'weak');
        continue;
      }
      map.set(source, 'none');
    }
    return map;
  }, [collectionLogs]);

  const qualityClass = (quality: 'good' | 'weak' | 'none') => {
    if (quality === 'good') return 'text-emerald-700 border-emerald-200 bg-emerald-50';
    if (quality === 'weak') return 'text-amber-700 border-amber-200 bg-amber-50';
    return 'text-slate-600 border-slate-200 bg-slate-50';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 text-sm p-1 max-w-full overflow-hidden">
      <div className="space-y-2.5 min-w-0">
        <h4 className="font-medium flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-muted">
          <Building2 className="w-3.5 h-3.5 shrink-0" /> Company Info
        </h4>
        {company.domain ? (
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="w-3.5 h-3.5 shrink-0 text-text-dim" />
            <a
              href={`https://${company.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline truncate text-sm"
              title={company.domain}
            >
              {company.domain}
            </a>
          </div>
        ) : (
          <span className="text-text-dim">No domain</span>
        )}
        {company.vertical && (
          <div className="flex items-center gap-2 min-w-0">
            <Target className="w-3.5 h-3.5 shrink-0 text-text-dim" />
            <span className="text-text-muted truncate" title={company.vertical}>
              {company.vertical}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-xs">Tier:</span>
          <TierBadge tier={company.tier} />
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <StatusBadge status={company.status} />
        </div>
      </div>
      <div className="space-y-2.5 min-w-0">
        <h4 className="font-medium flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-muted">
          <Target className="w-3.5 h-3.5 shrink-0" /> Target Strategy
        </h4>
        {company.target_reason ? (
          <p className="text-text-muted text-sm">{company.target_reason}</p>
        ) : (
          <span className="text-text-dim">No target reason</span>
        )}
      </div>
      <div className="space-y-2.5 min-w-0">
        <h4 className="font-medium flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-muted">
          <FileText className="w-3.5 h-3.5 shrink-0" /> Entry Point
        </h4>
        {company.wedge ? (
          <p className="text-text-muted text-sm">{company.wedge}</p>
        ) : (
          <span className="text-text-dim">No wedge defined</span>
        )}
      </div>
      <div className="space-y-2.5 min-w-0 md:col-span-3">
        <h4 className="font-medium flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-muted">
          <FileText className="w-3.5 h-3.5 shrink-0" /> BI & Source Evidence
        </h4>
        {biQuery.isLoading && <div className="text-xs text-text-dim">Loading BI context...</div>}
        {!biQuery.isLoading && !bi?.linked && (
          <div className="text-xs text-text-dim">No linked BI profile yet.</div>
        )}
        {bi?.linked && (
          <div className="space-y-3 rounded border border-border p-3 bg-white/30">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-text-muted">Link:</span>
              <span className="font-mono rounded border border-border px-2 py-0.5">{bi.company_key}</span>
              <span className="text-text-dim">
                {bi.match_method}, {(Number(bi.match_confidence || 0) * 100).toFixed(0)}%
              </span>
              <span className="ml-auto text-text-muted">
                Score: <span className="font-medium text-text-main">{bi.prospect_score?.score ?? '-'}</span>
              </span>
              <button
                type="button"
                onClick={() => setShowBiDetails((v) => !v)}
                className="ml-2 rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-slate-50"
              >
                {showBiDetails ? 'Show less' : 'Show details'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(bi.coverage || {}).map(([source, count]) => (
                <span key={source} className="rounded border border-border px-2 py-0.5 text-[11px] inline-flex items-center gap-1">
                  {sourceIcon(source)}
                  {source}: {count}
                  <span
                    className={`rounded border px-1 py-0 text-[10px] ${qualityClass(sourceQuality.get(String(source).toLowerCase()) || 'none')}`}
                  >
                    {sourceQuality.get(String(source).toLowerCase()) || 'none'}
                  </span>
                </span>
              ))}
            </div>
            {bi.prospect_score?.computed_at ? (
              <div className="text-xs text-text-dim">Computed {new Date(bi.prospect_score.computed_at).toLocaleString()}</div>
            ) : null}

            {showBiDetails && topAppEvidence.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-text-muted">App Evidence</div>
                {topAppEvidence.map((item, idx) => (
                  <div key={idx} className="text-xs text-text-muted break-words flex items-center gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{String(item.source || '-')}</span>
                    <span className="truncate">{String(item.summary || '')}</span>
                    {item.url ? (
                      <a
                        href={String(item.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline shrink-0"
                      >
                        source
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {showBiDetails && topSignals.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-text-muted">Recent Signals</div>
                {topSignals.map((sig, idx) => (
                  <div key={idx} className="text-xs text-text-muted break-words flex items-center gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{String(sig.source || '-')}</span>
                    <span className="text-text-main">{String(sig.signal_type || '-')}</span>
                    <span className="text-text-dim">{String(sig.strength || '-')}</span>
                    <span className="text-text-dim">{fmtDate(String(sig.detected_at || ''))}</span>
                    {sig.evidence_url ? (
                      <a
                        href={String(sig.evidence_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline shrink-0"
                      >
                        source
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {showBiDetails && sourceLinks.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-text-muted select-none">Source Links ({sourceLinks.length})</summary>
                <div className="mt-2 space-y-1">
                  {sourceLinks.slice(0, 12).map((link, idx) => (
                    <div key={idx} className="break-all">
                      <a
                        href={String(link.url || '#')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        [{String(link.source || 'source')}] {String(link.url || '')}
                      </a>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            {showBiDetails && collectionLogs.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-text-muted select-none">Collection Logs ({collectionLogs.length})</summary>
                <div className="mt-2 space-y-1">
                  {collectionLogs.slice(0, 10).map((log, idx) => (
                    <div key={idx} className="text-text-muted break-words">
                      {String(log.source || '-')}: {log.ok ? 'ok' : 'failed'} | {String(log.message || '')}
                      {log.link ? (
                        <>
                          {' '}
                          <a
                            href={String(log.link)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            source
                          </a>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
