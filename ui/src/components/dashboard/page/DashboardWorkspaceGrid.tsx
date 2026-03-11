import { CalendarClock, Users } from 'lucide-react';
import type { Contact, ReplyPreview } from '../../../api';
import { ActiveConversationsCard } from '../ActiveConversationsCard';
import { LiveContacts } from '../LiveContacts';
import { ScheduledSendsCard } from '../ScheduledSendsCard';
import { EmptyStateCard } from './EmptyStateCard';

type DashboardWorkspaceGridProps = {
  activeConversations: number;
  recentReplies: ReplyPreview[];
  outlookConnected: boolean;
  pollReplies: () => void;
  pollRepliesLoading: boolean;
  disconnectOutlook: () => void;
  onSelectConversation: (reply: ReplyPreview) => void;
  onMarkDone: (replyId: number) => void;
  removingIds: number[];
  todaysContacts: Contact[];
  onNavigateCompanies: () => void;
  onNavigateEmailHome: () => void;
  onNavigateEmailScheduled: () => void;
  nextSends: any[];
  totalScheduled: number;
};

export function DashboardWorkspaceGrid({
  activeConversations,
  recentReplies,
  outlookConnected,
  pollReplies,
  pollRepliesLoading,
  disconnectOutlook,
  onSelectConversation,
  onMarkDone,
  removingIds,
  todaysContacts,
  onNavigateCompanies,
  onNavigateEmailHome,
  onNavigateEmailScheduled,
  nextSends,
  totalScheduled,
}: DashboardWorkspaceGridProps) {
  return (
    <section className="grid h-full min-h-0 auto-rows-fr grid-cols-1 lg:grid-cols-12" data-component="dashboard-workspace-grid">
      <div className="flex min-h-[180px] min-h-0 flex-col overflow-hidden lg:col-span-5">
        {recentReplies.length > 0 ? (
          <ActiveConversationsCard
            activeConversations={activeConversations}
            recentReplies={recentReplies}
            outlookConnected={outlookConnected}
            pollReplies={pollReplies}
            pollRepliesLoading={pollRepliesLoading}
            disconnectOutlook={disconnectOutlook}
            onSelectConversation={onSelectConversation}
            onMarkDone={onMarkDone}
            removingIds={removingIds}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col border border-border bg-surface">
            <div className="flex h-[31px] items-center border-b border-border px-2.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Active Conversations</h3>
            </div>
            <EmptyStateCard
              title={
                outlookConnected
                  ? 'No open conversations right now'
                  : 'No conversations because inbox is not connected'
              }
              description={
                outlookConnected
                  ? 'Replies have been handled. Trigger a fresh campaign to generate new conversations.'
                  : 'Connect your inbox, then poll replies to start tracking conversations here.'
              }
              ctaLabel={outlookConnected ? 'Go to Email Campaigns' : 'Set up Email'}
              onCta={onNavigateEmailHome}
            />
          </div>
        )}
      </div>

      <div className="flex min-h-[180px] min-h-0 flex-col overflow-hidden border border-border bg-surface lg:col-span-3">
        <div className="flex h-[31px] items-center border-b border-border px-2.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Today&apos;s Contacts</h3>
        </div>
        <div className="min-h-0 flex-1">
          {todaysContacts.length > 0 ? (
            <LiveContacts contacts={todaysContacts} />
          ) : (
            <EmptyStateCard
              title="No contacts captured yet today"
              description="The contact stream is empty for this date. Run a company prospecting pass and enrich contacts."
              ctaLabel="Find Companies"
              onCta={onNavigateCompanies}
              Icon={Users}
            />
          )}
        </div>
      </div>

      <div className="flex min-h-[180px] min-h-0 flex-col overflow-hidden lg:col-span-4">
        {nextSends.length > 0 ? (
          <ScheduledSendsCard
            nextSends={nextSends}
            totalScheduled={totalScheduled}
            onNavigateEmailScheduled={onNavigateEmailScheduled}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col border border-border bg-surface">
            <div className="flex h-[31px] items-center border-b border-border px-2.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Next Scheduled Sends</h3>
            </div>
            <EmptyStateCard
              title="No sends scheduled for today"
              description="Your send queue is empty for this window. Schedule drafts to keep outreach cadence consistent."
              ctaLabel="Open Scheduled Queue"
              onCta={onNavigateEmailScheduled}
              Icon={CalendarClock}
            />
          </div>
        )}
      </div>
    </section>
  );
}
