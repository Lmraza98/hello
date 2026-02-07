import { Building2, Globe, Target, FileText } from 'lucide-react';
import type { Company } from '../../api';
import { TierBadge } from './TierBadge';
import { StatusBadge } from './StatusBadge';

type CompanyDetailProps = {
  company: Company;
};

export function CompanyDetail({ company }: CompanyDetailProps) {
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
    </div>
  );
}
