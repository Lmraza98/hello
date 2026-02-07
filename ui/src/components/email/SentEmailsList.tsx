import { useState } from 'react';
import { Mail, CheckCircle, XCircle, ChevronRight, ChevronDown, Eye, EyeOff, MessageSquare } from 'lucide-react';
import type { SentEmail } from '../../types/email';

type SentEmailsListProps = {
  emails: SentEmail[];
};

export function SentEmailsList({ emails }: SentEmailsListProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (emails.length === 0) {
    return (
      <div className="text-center py-10 md:py-12 text-text-muted">
        <Mail className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 md:mb-4 opacity-50" />
        <p className="text-sm md:text-base">No emails sent yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {emails.map(email => (
        <div key={email.id} className="border border-border rounded-lg overflow-hidden">
          <div
            className="px-3 md:px-4 py-2.5 md:py-3 flex items-center justify-between cursor-pointer hover:bg-surface-hover transition-colors"
            onClick={() => setExpanded(expanded === email.id ? null : email.id)}
          >
            <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
              {email.status === 'sent' ? (
                <CheckCircle className="w-3.5 h-3.5 md:w-4 md:h-4 text-success shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 md:w-4 md:h-4 text-error shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                  <span className="font-medium text-text text-xs md:text-sm truncate">{email.contact_name}</span>
                  <span className="text-text-dim hidden sm:inline">·</span>
                  <span className="text-text-muted text-[10px] md:text-sm truncate">{email.company_name}</span>
                </div>
                <div className="text-xs md:text-sm text-text-muted truncate mt-0.5">
                  <span className="bg-surface-hover px-1.5 py-0.5 rounded text-[10px] md:text-xs mr-1.5 md:mr-2">Email {email.step_number}</span>
                  {email.subject}
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 md:gap-3 shrink-0 ml-2 md:ml-4">
              {email.review_status === 'sent' && (
                <div className="flex items-center gap-1 md:gap-2">
                  {email.opened ? (
                    <span className="flex items-center gap-0.5 md:gap-1 text-[10px] md:text-xs text-blue-600 bg-blue-50 px-1.5 md:px-2 py-0.5 rounded-full">
                      <Eye className="w-2.5 h-2.5 md:w-3 md:h-3" />
                      {email.open_count > 1 ? `${email.open_count}x` : <span className="hidden sm:inline">Opened</span>}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-text-dim">
                      <EyeOff className="w-2.5 h-2.5 md:w-3 md:h-3" />
                    </span>
                  )}
                  {email.replied && (
                    <span className="flex items-center gap-0.5 md:gap-1 text-[10px] md:text-xs text-green-600 bg-green-50 px-1.5 md:px-2 py-0.5 rounded-full">
                      <MessageSquare className="w-2.5 h-2.5 md:w-3 md:h-3" />
                      <span className="hidden sm:inline">Reply</span>
                    </span>
                  )}
                </div>
              )}
              <span className="text-[10px] md:text-xs text-text-dim whitespace-nowrap">
                {new Date(email.sent_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
              {expanded === email.id ? <ChevronDown className="w-3.5 h-3.5 md:w-4 md:h-4 text-text-dim" /> : <ChevronRight className="w-3.5 h-3.5 md:w-4 md:h-4 text-text-dim" />}
            </div>
          </div>
          
          {expanded === email.id && (
            <div className="px-3 md:px-4 py-3 md:py-4 border-t border-border bg-bg">
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] md:text-xs font-medium text-text-muted uppercase tracking-wider">Subject</span>
                  <p className="text-text text-xs md:text-sm mt-1">{email.subject}</p>
                </div>
                <div>
                  <span className="text-[10px] md:text-xs font-medium text-text-muted uppercase tracking-wider">Body</span>
                  <pre className="text-text mt-1 whitespace-pre-wrap font-sans text-xs md:text-sm bg-surface p-2.5 md:p-3 rounded-lg overflow-x-auto">
                    {email.body}
                  </pre>
                </div>
                {email.last_tracked_at && (
                  <div className="text-[10px] md:text-xs text-text-dim">
                    Last tracked: {new Date(email.last_tracked_at).toLocaleString()}
                  </div>
                )}
                {email.error_message && (
                  <div>
                    <span className="text-[10px] md:text-xs font-medium text-red-600 uppercase tracking-wider">Error</span>
                    <p className="text-red-600 text-xs md:text-sm mt-1">{email.error_message}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
