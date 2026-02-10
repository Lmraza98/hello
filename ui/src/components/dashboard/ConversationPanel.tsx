import { useState, useEffect, useRef } from 'react';
import { X, Send, CheckCircle, CalendarCheck, Archive, ExternalLink, Loader2 } from 'lucide-react';
import { api, type ReplyPreview, type ConversationThread, type ThreadMessage } from '../../api';

type ConversationPanelProps = {
  reply: ReplyPreview;
  onClose: () => void;
  onMarkDone: (replyId: number) => void;
};

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

export function ConversationPanel({ reply, onClose, onMarkDone }: ConversationPanelProps) {
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Slide in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Load thread
  useEffect(() => {
    setLoading(true);
    api.getConversationThread(reply.contact_id)
      .then((data) => {
        setThread(data);
        setLoading(false);
        // Scroll to bottom after render
        setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      })
      .catch(() => setLoading(false));
  }, [reply.contact_id]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  const contact = thread?.contact;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 h-full w-full max-w-lg bg-surface border-l border-border shadow-xl z-50 flex flex-col transition-transform duration-300 ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-text">Conversation</h2>
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Contact Info */}
        <div className="px-5 py-3 border-b border-border bg-bg shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text">{contact?.name ?? reply.contact_name}</h3>
              <p className="text-xs text-text-muted">
                {contact?.title ?? reply.contact_title} @ {contact?.company_name ?? reply.company_name}
              </p>
              <p className="text-[11px] text-text-dim mt-0.5">{contact?.email ?? reply.contact_email}</p>
            </div>
            {contact?.linkedin_url && (
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4 text-text-muted" />
              </a>
            )}
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : thread?.thread && thread.thread.length > 0 ? (
            thread.thread.map((msg, i) => (
              <MessageBubble key={`${msg.msg_type}-${msg.id}-${i}`} message={msg} />
            ))
          ) : (
            <p className="text-xs text-text-dim text-center py-6">No messages in thread</p>
          )}
          <div ref={threadEndRef} />
        </div>

        {/* Reply Box */}
        <div className="px-5 py-3 border-t border-border shrink-0">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type a reply..."
                rows={2}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:border-accent resize-none bg-bg"
              />
              <span className="absolute bottom-1.5 right-2 text-[10px] text-text-dim">
                {replyText.length}/500
              </span>
            </div>
            <button
              disabled={!replyText.trim()}
              className="self-end px-3 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 px-5 py-3 border-t border-border bg-bg shrink-0">
          <button
            onClick={() => onMarkDone(reply.reply_id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 border border-green-200 rounded-lg hover:bg-green-50 transition-colors"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Mark as Handled
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted border border-border rounded-lg hover:bg-surface-hover transition-colors">
            <CalendarCheck className="w-3.5 h-3.5" />
            Schedule Meeting
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted border border-border rounded-lg hover:bg-surface-hover transition-colors">
            <Archive className="w-3.5 h-3.5" />
            Archive
          </button>
        </div>
      </div>
    </>
  );
}

function MessageBubble({ message }: { message: ThreadMessage }) {
  const isSent = message.msg_type === 'sent';

  return (
    <div className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isSent
            ? 'bg-accent/10 border border-accent/20'
            : 'bg-amber-50 border border-amber-100'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[10px] font-medium ${isSent ? 'text-accent' : 'text-amber-700'}`}>
            {isSent ? 'You' : 'Reply'}
            {message.campaign_name && (
              <span className="text-text-dim font-normal ml-1">
                · {message.campaign_name} (Email {message.step_number})
              </span>
            )}
          </span>
        </div>
        {message.subject && (
          <p className="text-xs font-medium text-text mb-0.5">{message.subject}</p>
        )}
        {message.body && (
          <p className="text-xs text-text-muted whitespace-pre-wrap leading-relaxed line-clamp-6">
            {message.body}
          </p>
        )}
        <p className="text-[10px] text-text-dim mt-1">{formatTime(message.timestamp)}</p>
      </div>
    </div>
  );
}
