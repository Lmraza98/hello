import { Globe } from 'lucide-react';
import type { Company } from '../../api';
import { MobileCard } from '../shared/MobileCard';
import { CompanyDetail } from './CompanyDetail';
import { TierBadge } from './TierBadge';
import { StatusBadge } from './StatusBadge';

type CompanyCardProps = {
  company: Company;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
};

export function CompanyCard({
  company,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
}: CompanyCardProps) {
  return (
    <MobileCard
      isSelected={isSelected}
      isExpanded={isExpanded}
      onToggleSelect={onToggleSelect}
      onToggleExpand={onToggleExpand}
      expandedContent={<CompanyDetail company={company} />}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="font-medium text-text text-sm truncate">{company.company_name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <TierBadge tier={company.tier} />
          <StatusBadge status={company.status} />
        </div>
      </div>
      {company.vertical && <p className="text-xs text-text-muted truncate mb-0.5">{company.vertical}</p>}
      {company.domain && (
        <div className="flex items-center gap-1 text-xs text-text-dim">
          <Globe className="w-3 h-3 shrink-0" />
          <span className="truncate">{company.domain}</span>
        </div>
      )}
    </MobileCard>
  );
}
