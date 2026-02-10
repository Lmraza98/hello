import { useState } from 'react';
import { MessageSquare, CheckCircle, Reply } from 'lucide-react';
import type { ReplyPreview } from '../../api';

type ConversationCardProps = {
  reply: ReplyPreview;
  onClick: () => void;
  onMarkDone: (replyId: number) => void;
  removing?: boolean;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ConversationCard({ reply, onClick, onMarkDone, removing }: ConversationCardProps) {
  const [showInlineReply, setShowInlineReply] = useState(false);
  const preview = reply.body_preview
    ? reply.body_preview.length > 60
      ? reply.body_preview.slice(0, 60) + '...'
      : reply.body_preview
    : 'No preview available';

  return (
    <div
      className={`group border border-border rounded-lg p-3 cursor-pointer hover:border-amber-200 hover:bg-amber-50/30 transition-all duration-300 ${
        removing ? 'opacity-0 scale-95 max-h-0 overflow-hidden mb-0 p-0 border-0' : 'max-h-40'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
          <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Name + Company */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-sm font-medium text-text truncate">{reply.contact_name}</span>
            <span className="text-[10px] text-text-dim">@</span>
            <span className="text-xs text-text-muted truncate">{reply.company_name}</span>
          </div>

          {/* Preview */}
          <p className="text-xs text-text-muted leading-snug mb-1.5 line-clamp-1">
            &ldquo;{preview}&rdquo;
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-dim">{timeAgo(reply.received_at)}</span>
            <span className="text-[10px] text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
              {reply.campaign_name}
            </span>
          </div>
        </div>
      </div>

      {/* Quick actions — show on hover */}
      <div className="flex items-center gap-1.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowInlineReply(!showInlineReply);
          }}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-muted border border-border rounded hover:bg-surface-hover transition-colors"
        >
          <Reply className="w-3 h-3" />
          Quick Reply
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMarkDone(reply.reply_id);
          }}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-green-700 border border-green-200 rounded hover:bg-green-50 transition-colors"
        >
          <CheckCircle className="w-3 h-3" />
          Mark Done
        </button>
      </div>

      {/* Inline reply (simple) */}
      {showInlineReply && (
        <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            placeholder="Type a quick reply..."
            className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:border-accent bg-bg"
            autoFocus
          />
          <button className="px-2.5 py-1.5 text-xs text-white bg-accent rounded-lg hover:bg-accent-hover transition-colors">
            Send
          </button>
        </div>
      )}
    </div>
  );
}
