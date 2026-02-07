import { useMemo } from 'react';
import { Clock, Send, Loader2 } from 'lucide-react';
import type { CampaignContact, SentEmail } from '../../types/email';

type QueueViewProps = {
  queue: CampaignContact[];
  scheduled: SentEmail[];
  onSendAll: () => void;
  isSending: boolean;
};

export function QueueView({ queue, scheduled, onSendAll, isSending }: QueueViewProps) {
  const groupedQueue = useMemo(() => {
    const groups: Record<string, CampaignContact[]> = {};
    const today = new Date().toLocaleDateString();
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString();
    
    queue.forEach(item => {
      let dateLabel: string;
      if (!item.next_email_at) {
        dateLabel = 'Ready Now';
      } else {
        const d = new Date(item.next_email_at).toLocaleDateString();
        if (d === today) dateLabel = 'Today';
        else if (d === tomorrow) dateLabel = 'Tomorrow';
        else dateLabel = d;
      }
      if (!groups[dateLabel]) groups[dateLabel] = [];
      groups[dateLabel].push(item);
    });
    
    return groups;
  }, [queue]);

  return (
    <div className="space-y-4 md:space-y-6">
      {scheduled.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4 md:p-6">
          <h3 className="text-base md:text-lg font-semibold text-text mb-3 md:mb-4 flex items-center gap-2">
            <Send className="w-4 h-4 md:w-5 md:h-5 text-accent" />
            Scheduled ({scheduled.length})
          </h3>
          <div className="space-y-1.5">
            {scheduled.map((email: SentEmail) => (
              <div key={email.id} className="flex items-center justify-between gap-3 px-3 md:px-4 py-2.5 md:py-3 bg-bg rounded-lg">
                <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                  <div className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-green-50 flex items-center justify-center shrink-0">
                    <Send className="w-3 h-3 md:w-3.5 md:h-3.5 text-green-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-text text-xs md:text-sm truncate">{email.contact_name}</p>
                    <p className="text-[10px] md:text-xs text-text-muted truncate">{email.company_name}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs md:text-sm text-text font-medium tabular-nums">
                    {email.scheduled_send_time ? new Date(email.scheduled_send_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
                  </p>
                  <p className="text-[10px] md:text-xs text-text-dim">
                    {email.scheduled_send_time ? new Date(email.scheduled_send_time).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-surface border border-border rounded-lg p-4 md:p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-base md:text-lg font-semibold text-text">Waiting for Next Email</h3>
          <button
            onClick={onSendAll}
            disabled={queue.length === 0 || isSending}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-xs md:text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" /> : <Send className="w-3.5 h-3.5 md:w-4 md:h-4" />}
            Send All ({queue.length})
          </button>
        </div>
        
        {queue.length === 0 ? (
          <div className="text-center py-8 md:py-12 text-text-muted">
            <Clock className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 md:mb-4 opacity-50" />
            <p className="text-sm md:text-base">No emails in queue</p>
            <p className="text-xs md:text-sm mt-1 px-4">Enroll contacts in an active campaign</p>
          </div>
        ) : (
          <div className="space-y-4 md:space-y-6">
            {Object.entries(groupedQueue).map(([dateLabel, items]) => (
              <div key={dateLabel}>
                <h4 className="text-xs md:text-sm font-medium text-text-muted mb-2 flex items-center gap-2">
                  <Clock className="w-3 h-3 md:w-3.5 md:h-3.5" />
                  {dateLabel}
                  <span className="text-text-dim">({items.length})</span>
                </h4>
                <div className="space-y-1.5">
                  {items.map((contact: CampaignContact) => (
                    <div key={contact.id} className="flex items-center justify-between gap-3 px-3 md:px-4 py-2.5 md:py-3 bg-bg rounded-lg">
                      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                        <div className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                          <span className="text-[10px] md:text-xs font-medium text-accent">{contact.current_step + 1}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-text text-xs md:text-sm truncate">{contact.contact_name}</p>
                          <p className="text-[10px] md:text-xs text-text-muted truncate">{contact.company_name}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs md:text-sm text-text tabular-nums">
                          {contact.next_email_at ? new Date(contact.next_email_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
