import { useState, useEffect, useRef } from 'react';
import { Play, Pause, MoreVertical, Edit3, Upload, Trash2, Users, Send, Loader2, Eye, MessageSquare } from 'lucide-react';
import type { EmailCampaign } from '../../types/email';

type CampaignCardProps = {
  campaign: EmailCampaign;
  onEditTemplates: () => void;
  onDelete: () => void;
  onActivate: () => void;
  onPause: () => void;
  onViewContacts: () => void;
  onSendEmails: () => void;
  onUploadToSalesforce: () => void;
  isUploading?: boolean;
};

export function CampaignCard({
  campaign,
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

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    active: 'bg-green-50 text-green-700',
    paused: 'bg-amber-50 text-amber-700',
    completed: 'bg-blue-50 text-blue-700'
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-4 md:p-6 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-3 md:mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm md:text-base font-semibold text-text truncate">{campaign.name}</h3>
            <span className={`px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-xs font-medium capitalize shrink-0 ${statusColors[campaign.status] || statusColors.draft}`}>
              {campaign.status}
            </span>
          </div>
          {campaign.description && (
            <p className="text-xs md:text-sm text-text-muted truncate">{campaign.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {campaign.status === 'active' ? (
            <button onClick={onPause} className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors" title="Pause">
              <Pause className="w-4 h-4 text-amber-600" />
            </button>
          ) : (
            <button onClick={onActivate} className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors" title="Activate">
              <Play className="w-4 h-4 text-green-600" />
            </button>
          )}
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
                <div className="border-t border-border my-1" />
                <button onClick={() => { setShowMenu(false); onDelete(); }} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors">
                  <Trash2 className="w-4 h-4" /> Delete Campaign
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 md:gap-4 mb-3">
        <div className="text-center">
          <div className="text-lg md:text-2xl font-bold text-text tabular-nums">{campaign.num_emails}</div>
          <div className="text-[10px] md:text-xs text-text-muted">Emails</div>
        </div>
        <div className="text-center">
          <div className="text-lg md:text-2xl font-bold text-text tabular-nums">{campaign.days_between_emails}</div>
          <div className="text-[10px] md:text-xs text-text-muted">Days</div>
        </div>
        <div className="text-center">
          <div className="text-lg md:text-2xl font-bold text-accent tabular-nums">{stats?.total_contacts || 0}</div>
          <div className="text-[10px] md:text-xs text-text-muted">Contacts</div>
        </div>
        <div className="text-center">
          <div className="text-lg md:text-2xl font-bold text-success tabular-nums">{stats?.total_sent || 0}</div>
          <div className="text-[10px] md:text-xs text-text-muted">Sent</div>
        </div>
      </div>

      {stats?.open_rate !== undefined && (stats?.total_sent || 0) > 0 && (
        <div className="flex items-center gap-3 md:gap-4 mb-3 md:mb-4 px-2">
          <div className="flex items-center gap-1 md:gap-1.5 text-xs md:text-sm">
            <Eye className="w-3 h-3 md:w-3.5 md:h-3.5 text-blue-500" />
            <span className="text-text-muted hidden sm:inline">Open:</span>
            <span className="font-medium text-text">{stats.open_rate || 0}%</span>
          </div>
          <div className="flex items-center gap-1 md:gap-1.5 text-xs md:text-sm">
            <MessageSquare className="w-3 h-3 md:w-3.5 md:h-3.5 text-green-500" />
            <span className="text-text-muted hidden sm:inline">Reply:</span>
            <span className="font-medium text-text">{stats.reply_rate || 0}%</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onViewContacts}
          className="flex-1 flex items-center justify-center gap-1.5 md:gap-2 px-2 md:px-3 py-2 border border-border rounded-lg text-xs md:text-sm font-medium text-text hover:bg-surface-hover transition-colors"
        >
          <Users className="w-3.5 h-3.5 md:w-4 md:h-4" />
          <span className="hidden sm:inline">Contacts</span>
        </button>
        <button
          onClick={onSendEmails}
          disabled={campaign.status !== 'active'}
          className="flex-1 flex items-center justify-center gap-1.5 md:gap-2 px-2 md:px-3 py-2 bg-accent text-white rounded-lg text-xs md:text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-3.5 h-3.5 md:w-4 md:h-4" />
          <span className="hidden sm:inline">Send Emails</span>
        </button>
      </div>
    </div>
  );
}
