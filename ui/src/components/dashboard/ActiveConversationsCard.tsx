import { useState } from 'react';
import { type ReplyPreview } from '../../api';
import { ConversationCard } from './ConversationCard';
import { CollapsibleSection } from './CollapsibleSection';
import {
  MessageCircle,
  RefreshCw,
  CheckCircle2,
  Unlink,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

export interface ActiveConversationsCardProps {
  activeConversations: number;
  recentReplies: ReplyPreview[];
  outlookConnected: boolean;
  pollReplies: () => void;
  pollRepliesLoading: boolean;
  disconnectOutlook: () => void;
  onSelectConversation: (reply: ReplyPreview) => void;
  onMarkDone: (replyId: number) => void;
  removingIds: number[]; // Array for proper React re-renders and memo compatibility
}

export function ActiveConversationsCard({
  activeConversations,
  recentReplies,
  outlookConnected,
  pollReplies,
  pollRepliesLoading,
  disconnectOutlook,
  onSelectConversation,
  onMarkDone,
  removingIds,
}: ActiveConversationsCardProps) {
  const [showAllConversations, setShowAllConversations] = useState(false);
  const visibleReplies = showAllConversations ? recentReplies : recentReplies.slice(0, 3);

  return (
    <CollapsibleSection
      title="Active Conversations"
      icon={MessageCircle}
      storageKey="active-conversations"
      defaultCollapsed={false}
      className="h-full"
      contentClassName="min-h-0 flex-1"
      badge={
        activeConversations > 0 ? (
          <span className="inline-flex h-4 min-w-4 items-center justify-center border border-amber-200 bg-amber-50 px-1 text-[10px] font-medium text-amber-700">
            {activeConversations}
          </span>
        ) : null
      }
      headerRight={
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {outlookConnected && (
            <>
              <button
                onClick={() => pollReplies()}
                disabled={pollRepliesLoading}
                className="inline-flex h-5 w-5 items-center justify-center border border-border text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-40"
                title="Check for new replies"
              >
                <RefreshCw className={`w-3 h-3 ${pollRepliesLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => disconnectOutlook()}
                className="inline-flex h-5 w-5 items-center justify-center border border-border text-text-dim transition-colors hover:border-red-200 hover:text-red-600"
                title="Disconnect Outlook"
              >
                <Unlink className="w-3 h-3" />
              </button>
            </>
          )}
          {outlookConnected && (
            <span className="inline-flex h-5 items-center gap-1 border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
              <CheckCircle2 className="w-2.5 h-2.5" />
              Live
            </span>
          )}
        </div>
      }
    >
      {recentReplies.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
            {visibleReplies.map((reply) => (
              <ConversationCard
                key={reply.reply_id}
                reply={reply}
                onClick={() => onSelectConversation(reply)}
                onMarkDone={onMarkDone}
                removing={removingIds.includes(reply.reply_id)}
              />
            ))}
          </div>
          {recentReplies.length > 3 ? (
            <button
              onClick={() => setShowAllConversations(!showAllConversations)}
              className="flex h-[31px] w-full items-center justify-center gap-1 border-t border-border px-3 text-[11px] font-medium text-accent transition-colors hover:bg-surface-hover hover:text-accent-hover"
            >
              {showAllConversations ? 'Show less' : `View All ${recentReplies.length}`}
              <ArrowRight className="w-3 h-3" />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Sparkles className="w-6 h-6 text-green-400 mb-2" />
          <p className="text-sm text-text-muted">No active conversations</p>
          <p className="text-xs text-text-dim mt-0.5">All caught up!</p>
        </div>
      )}
    </CollapsibleSection>
  );
}
