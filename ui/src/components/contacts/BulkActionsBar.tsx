import { Upload, UserPlus, Send, Phone, Target, Loader2, Trash2 } from 'lucide-react';

type BulkActionsBarProps = {
  selectedCount: number;
  onSalesforceUpload: () => void;
  onLinkedInRequest: () => void;
  onSendEmail: () => void;
  onCollectPhone: () => void;
  onEnrollInCampaign: () => void;
  onDelete: () => void;
  actionLoading: string | null;
};

export function BulkActionsBar({
  selectedCount,
  onSalesforceUpload,
  onLinkedInRequest,
  onSendEmail,
  onCollectPhone,
  onEnrollInCampaign,
  onDelete,
  actionLoading,
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="mb-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs md:text-sm font-medium text-indigo-900 mr-1">{selectedCount} selected</span>
        <button
          onClick={onSalesforceUpload}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1.5 bg-accent text-white rounded-md text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {actionLoading === 'salesforce' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          SF
        </button>
        <button
          onClick={onLinkedInRequest}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1.5 bg-accent text-white rounded-md text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {actionLoading === 'linkedin' ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
          LI
        </button>
        <button
          onClick={onSendEmail}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1.5 bg-accent text-white rounded-md text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {actionLoading === 'email' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Email
        </button>
        <button
          onClick={onCollectPhone}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1.5 bg-accent text-white rounded-md text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {actionLoading === 'phone' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
          Phone
        </button>
        <button
          onClick={onEnrollInCampaign}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1.5 border border-indigo-300 text-indigo-700 rounded-md text-xs font-medium hover:bg-indigo-100 disabled:opacity-50 transition-colors"
        >
          <Target className="w-3 h-3" />
          <span className="hidden md:inline">Enroll in Campaign</span>
          <span className="md:hidden">Campaign</span>
        </button>
        <button
          onClick={onDelete}
          disabled={actionLoading !== null}
          className="flex items-center gap-1 px-2 py-1.5 border border-red-300 text-red-700 rounded-md text-xs font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
        >
          {actionLoading === 'delete' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          <span className="hidden md:inline">Delete</span>
        </button>
      </div>
    </div>
  );
}
