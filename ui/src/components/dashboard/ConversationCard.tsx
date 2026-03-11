import { useState } from 'react';
import { CheckCircle, MessageSquare, Reply } from 'lucide-react';
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
      ? `${reply.body_preview.slice(0, 60)}...`
      : reply.body_preview
    : 'No preview available';

  return (
    <div
      className={`group cursor-pointer border-b border-border bg-surface px-2.5 py-2 transition-all duration-200 hover:bg-surface-hover ${
        removing ? 'max-h-0 overflow-hidden border-0 px-0 py-0 opacity-0' : 'max-h-40'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-amber-200 bg-amber-50">
          <MessageSquare className="h-3 w-3 text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-text">{reply.contact_name}</span>
            <span className="text-[10px] text-text-dim">@</span>
            <span className="truncate text-[11px] text-text-muted">{reply.company_name}</span>
          </div>
          <p className="mb-1.5 line-clamp-1 text-[11px] leading-snug text-text-muted">&ldquo;{preview}&rdquo;</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-dim">{timeAgo(reply.received_at)}</span>
            <span className="border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
              {reply.campaign_name}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          onClick={(event) => {
            event.stopPropagation();
            setShowInlineReply(!showInlineReply);
          }}
          className="flex h-6 items-center gap-1 border border-border px-2 text-[10px] text-text-muted transition-colors hover:bg-surface-hover"
        >
          <Reply className="h-3 w-3" />
          Quick Reply
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onMarkDone(reply.reply_id);
          }}
          className="flex h-6 items-center gap-1 border border-green-200 px-2 text-[10px] text-green-700 transition-colors hover:bg-green-50"
        >
          <CheckCircle className="h-3 w-3" />
          Mark Done
        </button>
      </div>

      {showInlineReply ? (
        <div className="mt-2 flex gap-1.5" onClick={(event) => event.stopPropagation()}>
          <input
            type="text"
            placeholder="Type a quick reply..."
            className="flex-1 border border-border bg-bg px-2.5 py-1.5 text-[11px] focus:border-accent focus:outline-none"
            autoFocus
          />
          <button className="bg-accent px-2.5 py-1.5 text-[11px] text-white transition-colors hover:bg-accent-hover">
            Send
          </button>
        </div>
      ) : null}
    </div>
  );
}
