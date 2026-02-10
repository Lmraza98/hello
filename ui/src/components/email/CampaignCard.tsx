import { useState, useEffect, useRef } from 'react';
import {
  Play, Pause, MoreVertical, Edit3, Upload, Trash2, Users, Send,
  Loader2, Eye, MessageSquare, Clock, AlertTriangle, Copy
} from 'lucide-react';
import type { EmailCampaign, CampaignScheduleSummary } from '../../types/email';

type CampaignCardProps = {
  campaign: EmailCampaign;
  scheduleSummary?: CampaignScheduleSummary;
  onEditTemplates: () => void;
  onDelete: () => void;
  onActivate: () => void;
  onPause: () => void;
  onViewContacts: () => void;
  onSendEmails: () => void;
  onUploadToSalesforce: () => void;
  isUploading?: boolean;
};

function formatNextSend(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today ${time}`;
  if (isTomorrow) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function formatCountdown(dateStr: string): string | null {
  const diffMs = new Date(dateStr).getTime() - Date.now();
  if (diffMs < 0 || diffMs > 2 * 60 * 60 * 1000) return null; // only show within 2h
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Sends now';
  if (mins < 60) return `Sends in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `Sends in ${hrs}h ${rem}m`;
}

function formatLastActivity(dateStr: string | null): string {
  if (!dateStr) return 'No sends yet';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just sent';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function CampaignCard({
  campaign,
  scheduleSummary,
  onEditTemplates,
  onDelete,
  onActivate,
  onPause,
  onViewContacts,
  onSendEmails,
  onUploadToSalesforce,
  isUploading
}: CampaignCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const stats = campaign.stats;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isActive = campaign.status === 'active';
  const isPaused = campaign.status === 'paused';
  const totalContacts = stats?.total_contacts || 0;
  const totalSent = stats?.total_sent || 0;
  const totalPossible = totalContacts * campaign.num_emails;
  const progressPct = totalPossible > 0 ? Math.round((totalSent / totalPossible) * 100) : 0;
  const countdown = scheduleSummary?.next_send_time ? formatCountdown(scheduleSummary.next_send_time) : null;

  const statusConfig: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    draft:     { bg: 'bg-gray-50',  border: 'border-gray-200', text: 'text-gray-600',  dot: 'bg-gray-400' },
    active:    { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', dot: 'bg-green-500' },
    paused:    { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500' },
    completed: { bg: 'bg-blue-50',  border: 'border-blue-200', text: 'text-blue-700',  dot: 'bg-blue-500' },
  };
  const sc = statusConfig[campaign.status] || statusConfig.draft;

  return (
    <div className={`bg-surface border rounded-lg p-4 md:p-5 hover:shadow-sm transition-shadow ${
      isActive ? 'border-green-200/60' : isPaused ? 'border-amber-200/60' : 'border-border'
    }`}>
      {/* Row 1: Name + Status + Actions */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm md:text-base font-semibold text-text truncate">{campaign.name}</h3>
            <span className={`inline-flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-xs font-medium capitalize shrink-0 border ${sc.bg} ${sc.border} ${sc.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
              {campaign.status}
            </span>
          </div>
          {campaign.description && (
            <p className="text-[10px] md:text-xs text-text-muted truncate">{campaign.description}</p>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0 ml-1">
          {/* Primary action button based on status */}
          {isPaused ? (
            <button
              onClick={onActivate}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600 text-white rounded-lg text-[10px] md:text-xs font-medium hover:bg-green-700 transition-colors"
            >
              <Play className="w-3 h-3" />
              Resume
            </button>
          ) : isActive ? (
            <button onClick={onPause} className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors" title="Pause">
              <Pause className="w-4 h-4 text-amber-600" />
            </button>
          ) : (
            <button onClick={onActivate} className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors" title="Activate">
              <Play className="w-4 h-4 text-green-600" />
            </button>
          )}

          {/* More menu */}
          <div className="relative" ref={menuRef}>
            <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors">
              <MoreVertical className="w-4 h-4 text-text-dim" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg py-1 z-10">
                <button onClick={() => { setShowMenu(false); onEditTemplates(); }} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover flex items-center gap-2 transition-colors">
                  <Edit3 className="w-4 h-4 text-text-muted" /> Edit Templates
                </button>
                <button
                  onClick={() => { setShowMenu(false); onUploadToSalesforce(); }}
                  disabled={isUploading}
                  className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin text-text-muted" /> : <Upload className="w-4 h-4 text-text-muted" />}
                  Upload to Salesforce
                </button>
                <button onClick={() => { setShowMenu(false); }} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover flex items-center gap-2 transition-colors">
                  <Copy className="w-4 h-4 text-text-muted" /> Duplicate
                </button>
                <div className="border-t border-border my-1" />
                <button onClick={() => { setShowMenu(false); onDelete(); }} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors">
                  <Trash2 className="w-4 h-4" /> Delete Campaign
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Metrics grid */}
      <div className="grid grid-cols-4 gap-2 md:gap-3 mb-2.5">
        <div className="text-center">
          <div className="text-base md:text-xl font-bold text-text tabular-nums">{campaign.num_emails}</div>
          <div className="text-[10px] md:text-xs text-text-muted">Emails</div>
        </div>
        <div className="text-center">
          <div className="text-base md:text-xl font-bold text-text tabular-nums">{campaign.days_between_emails}</div>
          <div className="text-[10px] md:text-xs text-text-muted">Days</div>
        </div>
        <div className="text-center">
          <div className="text-base md:text-xl font-bold text-accent tabular-nums">{totalContacts}</div>
          <div className="text-[10px] md:text-xs text-text-muted">Contacts</div>
        </div>
        <div className="text-center">
          <div className="text-base md:text-xl font-bold text-success tabular-nums">{totalSent}</div>
          <div className="text-[10px] md:text-xs text-text-muted">Sent</div>
        </div>
      </div>

      {/* Progress bar */}
      {totalPossible > 0 && (
        <div className="mb-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-text-dim">{progressPct}% complete</span>
            <span className="text-[10px] text-text-dim">{totalSent}/{totalPossible} emails</span>
          </div>
          <div className="h-1.5 bg-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Status-specific info section */}
      {isActive && scheduleSummary?.next_send_time && (
        <div className="flex items-center gap-1.5 mb-2.5 px-2.5 py-1.5 bg-green-50 border border-green-100 rounded-md">
          <Clock className="w-3 h-3 text-green-600 shrink-0" />
          <span className="text-xs text-green-800">
            Next: <span className="font-medium">{formatNextSend(scheduleSummary.next_send_time)}</span>
            {scheduleSummary.next_contact_name && (
              <span className="text-green-600"> ({scheduleSummary.next_contact_name})</span>
            )}
          </span>
          {countdown && (
            <span className="ml-auto text-[10px] font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
              {countdown}
            </span>
          )}
        </div>
      )}

      {isPaused && (scheduleSummary?.pending_review_count || scheduleSummary?.scheduled_count) ? (
        <div className="flex items-center gap-1.5 mb-2.5 px-2.5 py-1.5 bg-amber-50 border border-amber-100 rounded-md">
          <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
          <span className="text-xs text-amber-800">
            {scheduleSummary.pending_review_count > 0 && (
              <span className="font-medium">{scheduleSummary.pending_review_count} pending review</span>
            )}
            {scheduleSummary.pending_review_count > 0 && scheduleSummary.scheduled_count > 0 && ' · '}
            {scheduleSummary.scheduled_count > 0 && (
              <span>{scheduleSummary.scheduled_count} scheduled</span>
            )}
          </span>
        </div>
      ) : null}

      {isActive && !scheduleSummary?.next_send_time && scheduleSummary && (scheduleSummary.scheduled_count > 0 || scheduleSummary.pending_review_count > 0) && (
        <div className="flex items-center gap-1.5 mb-2.5 text-xs text-text-muted">
          <span className="w-3" />
          {scheduleSummary.scheduled_count > 0 && (
            <span>{scheduleSummary.scheduled_count} scheduled</span>
          )}
          {scheduleSummary.scheduled_count > 0 && scheduleSummary.pending_review_count > 0 && ' · '}
          {scheduleSummary.pending_review_count > 0 && (
            <span className="text-amber-600">{scheduleSummary.pending_review_count} pending review</span>
          )}
        </div>
      )}

      {/* Open & Reply rates */}
      {stats?.open_rate !== undefined && totalSent > 0 && (
        <div className="flex items-center gap-3 mb-2.5 px-1">
          <div className="flex items-center gap-1 text-xs">
            <Eye className="w-3 h-3 text-blue-500" />
            <span className="text-text-muted hidden sm:inline">Open:</span>
            <span className="font-medium text-text">{stats.open_rate || 0}%</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <MessageSquare className="w-3 h-3 text-green-500" />
            <span className="text-text-muted hidden sm:inline">Reply:</span>
            <span className="font-medium text-text">{stats.reply_rate || 0}%</span>
          </div>
          <div className="flex-1" />
          <span className="text-[10px] text-text-dim">
            Last: {formatLastActivity(scheduleSummary?.last_sent_at || null)}
          </span>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onViewContacts}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 md:px-3 py-2 border border-border rounded-lg text-xs md:text-sm font-medium text-text hover:bg-surface-hover transition-colors"
        >
          <Users className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Contacts</span>
        </button>
        {isPaused && scheduleSummary && scheduleSummary.pending_review_count > 0 ? (
          <button
            onClick={onSendEmails}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 md:px-3 py-2 bg-amber-600 text-white rounded-lg text-xs md:text-sm font-medium hover:bg-amber-700 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Review & Send</span>
          </button>
        ) : (
          <button
            onClick={onSendEmails}
            disabled={!isActive}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 md:px-3 py-2 bg-accent text-white rounded-lg text-xs md:text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Send Emails</span>
          </button>
        )}
      </div>
    </div>
  );
}
