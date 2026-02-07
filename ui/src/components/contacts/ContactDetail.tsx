import { useState } from 'react';
import { Mail, Phone, ExternalLink, Globe, Calendar, Target, Copy, Check } from 'lucide-react';
import type { Contact } from '../../api';
import { SalesforceStatusBadge } from './SalesforceStatusBadge';

type ContactDetailProps = {
  contact: Contact;
};

export function ContactDetail({ contact }: ContactDetailProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm max-w-full overflow-hidden">
      <div className="space-y-2 min-w-0">
        <h4 className="font-medium flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-muted">
          <Mail className="w-3.5 h-3.5 shrink-0" /> Email
        </h4>
        {contact.email ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-text truncate text-xs" title={contact.email}>
              {contact.email}
            </span>
            <button onClick={() => copyToClipboard(contact.email!, 'email')} className="p-0.5 hover:bg-surface-hover rounded shrink-0">
              {copiedField === 'email' ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-text-dim" />
              )}
            </button>
          </div>
        ) : (
          <span className="text-text-dim text-xs">No email</span>
        )}
        {contact.email_pattern && <div className="text-text-muted text-xs">Pattern: {contact.email_pattern}</div>}
      </div>

      <div className="space-y-2 min-w-0">
        <h4 className="font-medium flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-muted">
          <Phone className="w-3.5 h-3.5 shrink-0" /> Phone
        </h4>
        {contact.phone ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-text truncate text-xs">{contact.phone}</span>
              <button onClick={() => copyToClipboard(contact.phone!, 'phone')} className="p-0.5 hover:bg-surface-hover rounded shrink-0">
                {copiedField === 'phone' ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-text-dim" />
                )}
              </button>
            </div>
            {contact.phone_source && (
              <div className="text-text-muted text-xs break-words">
                Source: {contact.phone_source} {contact.phone_confidence !== null && `(${contact.phone_confidence}%)`}
              </div>
            )}
          </>
        ) : (
          <span className="text-text-dim text-xs">No phone</span>
        )}
      </div>

      <div className="space-y-2 min-w-0">
        <h4 className="font-medium flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-muted">
          <ExternalLink className="w-3.5 h-3.5 shrink-0" /> LinkedIn
        </h4>
        {contact.linkedin_url ? (
          <a
            href={contact.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-accent hover:underline text-xs min-w-0"
            title={contact.linkedin_url}
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {contact.linkedin_url.includes('/in/')
                ? contact.linkedin_url.split('/in/')[1]?.split('/')[0]
                : contact.linkedin_url.includes('sales/lead')
                ? 'Sales Navigator'
                : 'LinkedIn'}
            </span>
          </a>
        ) : (
          <span className="text-text-dim text-xs">No LinkedIn</span>
        )}
      </div>

      <div className="space-y-2 min-w-0">
        <h4 className="font-medium flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-muted">
          <Target className="w-3.5 h-3.5 shrink-0" /> Details
        </h4>
        {contact.vertical && (
          <div className="flex items-center gap-1.5 text-text-muted text-xs min-w-0">
            <span className="truncate" title={contact.vertical}>
              {contact.vertical}
            </span>
          </div>
        )}
        {contact.domain && (
          <div className="flex items-center gap-1.5 text-text-muted text-xs min-w-0">
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{contact.domain}</span>
          </div>
        )}
        {contact.scraped_at && (
          <div className="flex items-center gap-1.5 text-text-muted text-xs min-w-0">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{new Date(contact.scraped_at).toLocaleDateString()}</span>
          </div>
        )}
        <SalesforceStatusBadge status={contact.salesforce_status} />
      </div>
    </div>
  );
}
