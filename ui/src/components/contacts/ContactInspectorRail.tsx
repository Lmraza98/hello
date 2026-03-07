import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Mail, Phone, UserX } from 'lucide-react';
import type { Contact } from '../../api';
import { EngagementStatusBadge } from './SalesforceStatusBadge';
import { getContactSourceLabel } from './sourceLabel';

type ContactInspectorRailProps = {
  contact: Contact;
  onClose: () => void;
  onAddToCampaign: (contact: Contact) => void;
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

export function ContactInspectorRail({
  contact,
  onClose,
  onAddToCampaign,
}: ContactInspectorRailProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const openDetailsHref = useMemo(
    () => contact.salesforce_url || contact.linkedin_url || (contact.domain ? `https://${contact.domain}` : ''),
    [contact.salesforce_url, contact.linkedin_url, contact.domain]
  );

  const copyValue = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1500);
    } catch {
      setCopiedField(null);
    }
  };

  return (
    <aside className="w-[340px] shrink-0 border-l border-border bg-surface flex flex-col min-h-0">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text">{contact.name}</h3>
            <p className="truncate text-xs text-text-muted">{contact.title || 'No title'}</p>
            <p className="truncate text-xs text-text-muted">{contact.company_name || 'No company'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs text-text-muted hover:bg-surface-hover"
          >
            <UserX className="mr-1 h-3.5 w-3.5" /> Close
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3 text-xs">
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Quick Facts</p>
            <div className="space-y-1.5 rounded-md border border-border bg-bg p-2.5">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-text-dim" />
                <span className="min-w-0 flex-1 truncate text-text">{contact.email || '-'}</span>
                {contact.email ? (
                  <button type="button" onClick={() => copyValue(contact.email!, 'email')} className="text-text-dim hover:text-text">
                    {copiedField === 'email' ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-text-dim" />
                <span className="min-w-0 flex-1 truncate text-text">{contact.phone || '-'}</span>
                {contact.phone ? (
                  <button type="button" onClick={() => copyValue(contact.phone!, 'phone')} className="text-text-dim hover:text-text">
                    {copiedField === 'phone' ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">LinkedIn</span>
                {contact.linkedin_url ? (
                  <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Open <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="text-text">-</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">Salesforce</span>
                {contact.salesforce_url ? (
                  <a href={contact.salesforce_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Open <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="text-text">-</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">Source</span>
                <span className="text-text">{getContactSourceLabel(contact)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">Status</span>
                <EngagementStatusBadge status={contact.engagement_status} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">Created</span>
                <span className="text-text">{formatDate(contact.scraped_at)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Actions</p>
            <div className="grid grid-cols-1 gap-1.5">
              <button
                type="button"
                onClick={() => onAddToCampaign(contact)}
                className="h-8 rounded-md border border-border bg-surface px-2.5 text-left text-xs text-text hover:bg-surface-hover"
              >
                Add to campaign
              </button>
            </div>
          </div>

          <div className="pt-1">
            {openDetailsHref ? (
              <a
                href={openDetailsHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                Open full details <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span className="text-xs text-text-dim">Open full details unavailable</span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
