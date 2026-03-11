import { ScheduledSendRow } from './ScheduledSendRow';
import { CollapsibleSection } from './CollapsibleSection';
import { Clock, Mail, ChevronRight } from 'lucide-react';

export interface ScheduledSendsCardProps {
  nextSends: any[];
  totalScheduled: number;
  onNavigateEmailScheduled: () => void;
}

export function ScheduledSendsCard({
  nextSends,
  totalScheduled,
  onNavigateEmailScheduled,
}: ScheduledSendsCardProps) {
  return (
    <CollapsibleSection
      title="Next Scheduled Sends"
      icon={Clock}
      storageKey="scheduled-sends"
      defaultCollapsed={false}
      className="h-full"
      contentClassName="min-h-0 flex-1"
      badge={
        nextSends.length > 0 ? (
          <span className="inline-flex h-4 items-center border border-accent/20 bg-accent/10 px-1.5 text-[10px] font-medium text-accent">
            {nextSends.length} today
          </span>
        ) : null
      }
      headerRight={
        totalScheduled > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onNavigateEmailScheduled();
            }}
            className="flex h-5 items-center gap-1 text-[11px] font-medium text-accent hover:text-accent-hover"
          >
            View All
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : null
      }
    >
      {nextSends.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          {nextSends.map((email: any) => (
            <ScheduledSendRow key={email.id} email={email} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center px-3 py-6 text-center">
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
