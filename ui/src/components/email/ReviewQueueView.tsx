import { useState } from 'react';
import { CheckCircle, RefreshCw, Loader2, Check, X, Edit3, Clock } from 'lucide-react';
import type { ReviewQueueItem } from '../../types/email';

type ReviewQueueViewProps = {
  reviewQueue: ReviewQueueItem[];
  scheduledCount: number;
  onPrepareBatch: () => void;
  onApproveEmail: (emailId: number, subject?: string, body?: string) => void;
  onRejectEmail: (emailId: number) => void;
  onApproveAll: (emailIds: number[]) => void;
  isPreparingBatch: boolean;
  isApprovingEmail: boolean;
  isRejectingEmail: boolean;
  isApprovingAll: boolean;
};

export function ReviewQueueView({
  reviewQueue,
  scheduledCount,
  onPrepareBatch,
  onApproveEmail,
  onRejectEmail,
  onApproveAll,
  isPreparingBatch,
  isApprovingEmail,
  isRejectingEmail,
  isApprovingAll
}: ReviewQueueViewProps) {
  const [editingEmail, setEditingEmail] = useState<number | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  return (
    <div className="bg-surface border border-border rounded-lg p-4 md:p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <h3 className="text-base md:text-lg font-semibold text-text">Review Queue</h3>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={onPrepareBatch}
            disabled={isPreparingBatch}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 md:gap-2 px-3 py-2 border border-border rounded-lg text-xs md:text-sm font-medium text-text hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            {isPreparingBatch ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 md:w-4 md:h-4" />}
            <span className="hidden sm:inline">Prepare Batch</span>
            <span className="sm:hidden">Prepare</span>
          </button>
          {reviewQueue.length > 0 && (
            <button
              onClick={() => onApproveAll(reviewQueue.map(e => e.id))}
              disabled={isApprovingAll}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 bg-green-600 text-white rounded-lg text-xs md:text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {isApprovingAll ? <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 md:w-4 md:h-4" />}
              Approve All ({reviewQueue.length})
            </button>
          )}
        </div>
      </div>

      {/* Scheduling info banner */}
      {reviewQueue.length > 0 && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
          <Clock className="w-4 h-4 text-blue-600 shrink-0" />
          <p className="text-xs md:text-sm text-blue-800">
            After approval, <span className="font-medium">{reviewQueue.length} email{reviewQueue.length !== 1 ? 's' : ''}</span> will be scheduled for sending.
            {scheduledCount > 0 && (
              <span className="text-blue-600"> ({scheduledCount} already scheduled)</span>
            )}
          </p>
        </div>
      )}

      {reviewQueue.length === 0 ? (
        <div className="text-center py-10 md:py-12 text-text-muted">
          <CheckCircle className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 md:mb-4 opacity-50" />
          <p className="text-sm md:text-base">No emails pending review</p>
          <p className="text-xs md:text-sm mt-1 px-4">Click "Prepare Batch" to generate drafts</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviewQueue.map(email => (
            <div key={email.id} className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 md:px-4 py-2.5 md:py-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-1">
                    <span className="font-medium text-text text-sm md:text-base truncate">{email.contact_name}</span>
                    <span className="text-text-dim hidden sm:inline">·</span>
                    <span className="text-text-muted text-xs md:text-sm truncate">{email.company_name}</span>
                    {email.contact_title && (
                      <>
                        <span className="text-text-dim hidden sm:inline">·</span>
                        <span className="text-text-muted text-xs md:text-sm truncate">{email.contact_title}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-indigo-50 text-accent px-2 py-0.5 rounded text-[10px] md:text-xs font-medium">
                      {email.campaign_name} — Email {email.step_number}
                    </span>
                  </div>

                  {editingEmail === email.id ? (
                    <div className="space-y-2 mt-2">
                      <input
                        type="text"
                        value={editSubject}
                        onChange={e => setEditSubject(e.target.value)}
                        className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text text-sm focus:outline-none focus:border-accent"
                      />
                      <textarea
                        value={editBody}
                        onChange={e => setEditBody(e.target.value)}
                        rows={6}
                        className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text text-sm font-mono focus:outline-none focus:border-accent resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            onApproveEmail(email.id, editSubject, editBody);
                            setEditingEmail(null);
                          }}
                          className="flex-1 sm:flex-none px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs md:text-sm font-medium hover:bg-green-700 transition-colors"
                        >
                          Save & Approve
                        </button>
                        <button
                          onClick={() => setEditingEmail(null)}
                          className="px-3 py-1.5 text-text-muted hover:text-text text-xs md:text-sm transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs md:text-sm font-medium text-text">{email.rendered_subject}</p>
                      <p className="text-xs md:text-sm text-text-muted mt-1 line-clamp-2 whitespace-pre-line">{email.rendered_body}</p>
                    </>
                  )}
                </div>

                {editingEmail !== email.id && (
                  <div className="flex flex-col sm:flex-row items-center gap-1 shrink-0">
                    <button
                      onClick={() => onApproveEmail(email.id)}
                      disabled={isApprovingEmail}
                      className="p-1.5 md:p-2 hover:bg-green-50 rounded-lg transition-colors"
                      title="Approve"
                    >
                      <Check className="w-4 h-4 md:w-5 md:h-5 text-green-600" />
                    </button>
                    <button
                      onClick={() => {
                        setEditingEmail(email.id);
                        setEditSubject(email.rendered_subject || '');
                        setEditBody(email.rendered_body || '');
                      }}
                      className="p-1.5 md:p-2 hover:bg-surface-hover rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Edit3 className="w-4 h-4 md:w-5 md:h-5 text-text-muted" />
                    </button>
                    <button
                      onClick={() => onRejectEmail(email.id)}
                      disabled={isRejectingEmail}
                      className="p-1.5 md:p-2 hover:bg-red-50 rounded-lg transition-colors"
                      title="Reject"
                    >
                      <X className="w-4 h-4 md:w-5 md:h-5 text-red-500" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
