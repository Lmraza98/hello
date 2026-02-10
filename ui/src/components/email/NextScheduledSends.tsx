import { useMemo, useState } from 'react';
import { Clock, Send, Eye, Edit3, CalendarClock, ChevronRight, ChevronDown } from 'lucide-react';
import type { ScheduledEmail } from '../../types/email';

type NextScheduledSendsProps = {
  scheduledEmails: ScheduledEmail[];
  onViewEmail: (email: ScheduledEmail) => void;
  onEditEmail: (email: ScheduledEmail) => void;
  onSendNow: (emailId: number) => void;
  onViewAll: () => void;
};

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatCountdown(dateStr: string): string {
  const diffMs = new Date(dateStr).getTime() - Date.now();
  if (diffMs < 0) return 'Overdue';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Now';
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `in ${hrs}h ${remMins}m` : `in ${hrs}h`;
}

export function NextScheduledSends({
  scheduledEmails,
  onViewEmail,
  onEditEmail,
  onSendNow,
  onViewAll
}: NextScheduledSendsProps) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Filter to today only
  const todayEmails = useMemo(() => {
    const todayStr = new Date().toDateString();
    return scheduledEmails.filter(e => new Date(e.scheduled_send_time).toDateString() === todayStr);
  }, [scheduledEmails]);

  const totalScheduled = scheduledEmails.length;

  return (
    <div className="bg-surface border border-border rounded-lg mb-4 md:mb-6 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 md:px-5 py-3 hover:bg-surface-hover transition-colors"
      >
        <h3 className="text-sm md:text-base font-semibold text-text flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-accent" />
          Next Sends (Today)
          {todayEmails.length > 0 && (
            <span className="text-[10px] md:text-xs font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
              {todayEmails.length}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {totalScheduled > 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); onViewAll(); }}
              className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1 transition-colors"
            >
              View All Scheduled ({totalScheduled})
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          )}
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-text-dim" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-dim" />
          )}
        </div>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-4 md:px-5 pb-3 md:pb-4">
          {todayEmails.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-xs md:text-sm text-text-muted">
              <Clock className="w-3.5 h-3.5 text-text-dim" />
              No sends scheduled for today
              {totalScheduled > 0 && (
                <span className="text-text-dim">
                  · {totalScheduled} scheduled later
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {todayEmails.map(email => (
                <div
                  key={email.id}
                  className="relative flex items-center gap-3 px-3 py-2 bg-bg rounded-lg hover:bg-surface-hover transition-colors group cursor-pointer"
                  onMouseEnter={() => setHoveredId(email.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => onViewEmail(email)}
                >
                  {/* Time */}
                  <div className="shrink-0 w-[72px] md:w-20">
                    <div className="text-xs md:text-sm font-medium text-accent tabular-nums">
                      {formatTime(email.scheduled_send_time)}
                    </div>
                    <div className="text-[10px] text-text-dim tabular-nums">
                      {formatCountdown(email.scheduled_send_time)}
                    </div>
                  </div>

                  {/* Contact */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-text text-xs md:text-sm truncate">
                        {email.contact_name}
                      </span>
                      <span className="text-text-dim text-[10px]">@</span>
                      <span className="text-text-muted text-[10px] md:text-xs truncate">
                        {email.company_name}
                      </span>
                    </div>
                    <p className="text-[10px] md:text-xs text-text-dim truncate">
                      Email {email.step_number}: &ldquo;{email.rendered_subject || email.subject}&rdquo;
                    </p>
                  </div>

                  {/* Hover actions */}
                  {hoveredId === email.id && (
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-surface border border-border rounded-lg shadow-sm px-0.5 py-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewEmail(email); }}
                        className="p-1.5 hover:bg-surface-hover rounded transition-colors"
                        title="View"
                      >
                        <Eye className="w-3 h-3 text-text-muted" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onEditEmail(email); }}
                        className="p-1.5 hover:bg-surface-hover rounded transition-colors"
                        title="Edit"
                      >
                        <Edit3 className="w-3 h-3 text-text-muted" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onSendNow(email.id); }}
                        className="p-1.5 hover:bg-green-50 rounded transition-colors"
                        title="Send Now"
                      >
                        <Send className="w-3 h-3 text-green-600" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
