import { Building2, CheckCircle, Cloud, ExternalLink, XCircle } from 'lucide-react';
import type { Contact } from '../../api';
import { MobileCard } from '../shared/MobileCard';
import { ContactDetail } from './ContactDetail';
import { SalesforceStatusBadge } from './SalesforceStatusBadge';

type ContactCardProps = {
  contact: Contact;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
};

export function ContactCard({
  contact,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
}: ContactCardProps) {
  return (
    <MobileCard
      isSelected={isSelected}
      isExpanded={isExpanded}
      onToggleSelect={onToggleSelect}
      onToggleExpand={onToggleExpand}
      expandedContent={<ContactDetail contact={contact} />}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="font-medium text-text text-sm truncate">{contact.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {contact.salesforce_url ? (
            <a
              href={contact.salesforce_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text"
              title="Open in Salesforce"
              onClick={(e) => e.stopPropagation()}
            >
              <Cloud className="h-3 w-3 text-blue-600" />
              In SF <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {contact.email ? (
            <CheckCircle className="w-3.5 h-3.5 text-success" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-text-dim/40" />
          )}
          <SalesforceStatusBadge status={contact.salesforce_status} />
        </div>
      </div>
      {contact.title && <p className="text-xs text-text-muted truncate mb-0.5">{contact.title}</p>}
      <div className="flex items-center gap-1 text-xs text-text-dim">
        <Building2 className="w-3 h-3 shrink-0" />
        <span className="truncate">{contact.company_name}</span>
      </div>
    </MobileCard>
  );
}
