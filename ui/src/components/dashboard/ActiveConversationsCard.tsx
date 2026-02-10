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
      badge={
        activeConversations > 0 ? (
          <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
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
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-muted border border-border rounded hover:text-text hover:bg-surface-hover transition-colors disabled:opacity-40"
                title="Check for new replies"
              >
                <RefreshCw className={`w-3 h-3 ${pollRepliesLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => disconnectOutlook()}
                className="p-1 text-text-dim border border-border rounded hover:text-red-600 hover:border-red-200 transition-colors"
                title="Disconnect Outlook"
              >
                <Unlink className="w-3 h-3" />
              </button>
            </>
          )}
          {outlookConnected && (
            <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 className="w-2.5 h-2.5" />
            </span>
          )}
        </div>
      }
    >
      {recentReplies.length > 0 ? (
        <div className="space-y-2">
          {visibleReplies.map((reply) => (
            <ConversationCard
              key={reply.reply_id}
              reply={reply}
              onClick={() => onSelectConversation(reply)}
              onMarkDone={onMarkDone}
              removing={removingIds.includes(reply.reply_id)}
            />
          ))}
          {recentReplies.length > 3 && (
            <button
              onClick={() => setShowAllConversations(!showAllConversations)}
              className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover font-medium w-full justify-center py-1.5 transition-colors"
            >
              {showAllConversations ? 'Show less' : `View All ${recentReplies.length}`}
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
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
