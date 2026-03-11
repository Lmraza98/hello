import { useMemo } from 'react';

export interface ScheduledSendRowProps {
  email: any;
}

export function ScheduledSendRow({ email }: ScheduledSendRowProps) {
  const time = email.scheduled_send_time
    ? new Date(email.scheduled_send_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const countdown = useMemo(() => {
    if (!email.scheduled_send_time) return '';
    const diffMs = new Date(email.scheduled_send_time).getTime() - Date.now();
    if (diffMs < 0) return 'Overdue';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Now';
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    return hrs > 0 ? `in ${hrs}h ${mins % 60}m` : `in ${mins}m`;
  }, [email.scheduled_send_time]);

  return (
    <div className="flex items-center gap-2.5 border-b border-border px-2.5 py-2 transition-colors hover:bg-surface-hover">
      <div className="w-16 shrink-0">
        <div className="text-[11px] font-medium text-accent tabular-nums">{time}</div>
        <div className="text-[10px] text-text-dim tabular-nums">{countdown}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] font-medium text-text">{email.contact_name}</span>
          <span className="text-text-dim text-[10px]">@</span>
          <span className="text-text-muted text-[10px] truncate">{email.company_name}</span>
        </div>
        <p className="text-[10px] text-text-dim truncate">
          {email.rendered_subject || email.subject}
        </p>
      </div>
      <span className="hidden shrink-0 border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent md:inline-flex">
        {email.campaign_name}
      </span>
    </div>
  );
}
