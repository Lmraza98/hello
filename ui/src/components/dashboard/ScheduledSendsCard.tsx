import { ScheduledSendRow } from './ScheduledSendRow';
import { CollapsibleSection } from './CollapsibleSection';
import { Clock, Mail, ChevronRight } from 'lucide-react';

export interface ScheduledSendsCardProps {
  nextSends: any[];
  totalScheduled: number;
}

export function ScheduledSendsCard({
  nextSends,
  totalScheduled,
}: ScheduledSendsCardProps) {
  return (
    <CollapsibleSection
      title="Next Scheduled Sends"
      icon={Clock}
      storageKey="scheduled-sends"
      defaultCollapsed={false}
      badge={
        nextSends.length > 0 ? (
          <span className="text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
            {nextSends.length} today
          </span>
        ) : null
      }
      headerRight={
        totalScheduled > 0 ? (
          <span className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1 cursor-pointer">
            View All
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        ) : null
      }
    >
      {nextSends.length > 0 ? (
        <div className="space-y-1.5">
          {nextSends.map((email: any) => (
            <ScheduledSendRow key={email.id} email={email} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Mail className="w-6 h-6 text-text-dim opacity-30 mb-2" />
          <p className="text-sm text-text-muted">No emails scheduled for today</p>
          <p className="text-xs text-text-dim mt-0.5">
            <a href="/email" className="text-accent hover:text-accent-hover">
              Review pending emails
            </a>{' '}
            or{' '}
            <a href="/email" className="text-accent hover:text-accent-hover">
              create a campaign
            </a>
          </p>
        </div>
      )}
    </CollapsibleSection>
  );
}
