import { useMemo, useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, Send, GripVertical, Eye, Edit3, MoreVertical, CalendarClock, Filter, Loader2 } from 'lucide-react';
import type { ScheduledEmail, CampaignContact } from '../../types/email';

type ScheduledViewProps = {
  allScheduled: ScheduledEmail[];
  queue: CampaignContact[];
  onViewEmail: (email: ScheduledEmail) => void;
  onEditEmail: (email: ScheduledEmail) => void;
  onSendNow: (emailId: number) => void;
  onReschedule: (email: ScheduledEmail) => void;
  onReorder: (emailIds: number[], startTime?: string) => void;
  onSendAll: () => void;
  onReviewInTabs: () => void;
  isSending: boolean;
  isReviewLaunching: boolean;
};

type DateGroup = {
  label: string;
  sortKey: number;
  emails: ScheduledEmail[];
};

function groupByDate(emails: ScheduledEmail[]): DateGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));

  const groups: Record<string, { sortKey: number; emails: ScheduledEmail[] }> = {};

  for (const email of emails) {
    const date = new Date(email.scheduled_send_time);
    const emailDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let label: string;
    let sortKey: number;

    if (emailDate.getTime() === today.getTime()) {
      label = 'TODAY';
      sortKey = 0;
    } else if (emailDate.getTime() === tomorrow.getTime()) {
      label = 'TOMORROW';
      sortKey = 1;
    } else if (emailDate < endOfWeek) {
      label = 'THIS WEEK';
      sortKey = 2;
    } else {
      label = 'LATER';
      sortKey = 3;
    }

    if (!groups[label]) groups[label] = { sortKey, emails: [] };
    groups[label].emails.push(email);
  }

  return Object.entries(groups)
    .map(([label, { sortKey, emails }]) => ({ label, sortKey, emails }))
    .sort((a, b) => a.sortKey - b.sortKey);
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ── Sortable row ──────────────────────────────────── */

function SortableEmailRow({
  email,
  onView,
  onEdit,
  onSendNow,
  onReschedule
}: {
  email: ScheduledEmail;
  onView: () => void;
  onEdit: () => void;
  onSendNow: () => void;
  onReschedule: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: email.id });
  const [showMenu, setShowMenu] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2.5 md:py-3 rounded-lg transition-colors group ${
        isDragging ? 'bg-accent/5 shadow-md border border-accent/20' : 'bg-bg hover:bg-surface-hover'
      }`}
    >
      {/* Drag handle */}
      <button
        className="cursor-grab active:cursor-grabbing shrink-0 p-0.5 text-text-dim hover:text-text-muted transition-colors touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Time */}
      <div className="shrink-0 w-16 md:w-20 text-right">
        <span className="text-xs md:text-sm font-medium text-text tabular-nums">
          {formatTime(email.scheduled_send_time)}
        </span>
      </div>

      {/* Contact info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-text text-xs md:text-sm truncate">{email.contact_name}</span>
          <span className="text-text-dim text-xs">→</span>
          <span className="text-accent text-[10px] md:text-xs font-medium shrink-0">Email {email.step_number}</span>
        </div>
        <p className="text-[10px] md:text-xs text-text-muted truncate">{email.company_name}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onView} className="p-1.5 hover:bg-surface rounded transition-colors" title="View">
          <Eye className="w-3.5 h-3.5 text-text-muted" />
        </button>
        <button onClick={onEdit} className="p-1.5 hover:bg-surface rounded transition-colors" title="Edit">
          <Edit3 className="w-3.5 h-3.5 text-text-muted" />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 hover:bg-surface rounded transition-colors"
          >
            <MoreVertical className="w-3.5 h-3.5 text-text-muted" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-surface border border-border rounded-lg shadow-lg py-1 z-20">
              <button
                onClick={() => { setShowMenu(false); onSendNow(); }}
                className="w-full px-3 py-2 text-left text-xs text-text hover:bg-surface-hover flex items-center gap-2"
              >
                <Send className="w-3.5 h-3.5 text-green-600" /> Send Now
              </button>
              <button
                onClick={() => { setShowMenu(false); onReschedule(); }}
                className="w-full px-3 py-2 text-left text-xs text-text hover:bg-surface-hover flex items-center gap-2"
              >
                <CalendarClock className="w-3.5 h-3.5 text-text-muted" /> Reschedule
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────── */

export function ScheduledView({
  allScheduled,
  queue,
  onViewEmail,
  onEditEmail,
  onSendNow,
  onReschedule,
  onReorder,
  onSendAll,
  onReviewInTabs,
  isSending,
  isReviewLaunching
}: ScheduledViewProps) {
  const [campaignFilter, setCampaignFilter] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // Unique campaigns for filter dropdown
  const campaigns = useMemo(() => {
    const map = new Map<number, string>();
    allScheduled.forEach(e => map.set(e.campaign_id, e.campaign_name));
    return Array.from(map.entries());
  }, [allScheduled]);

  // Filtered emails
  const filtered = useMemo(() => {
    if (!campaignFilter) return allScheduled;
    return allScheduled.filter(e => e.campaign_id === campaignFilter);
  }, [allScheduled, campaignFilter]);

  // Grouped by date
  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  // Flat sorted IDs for drag context
  const allIds = useMemo(() => filtered.map(e => e.id), [filtered]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = allIds.indexOf(Number(active.id));
    const newIndex = allIds.indexOf(Number(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(allIds, oldIndex, newIndex);

    // Find the start time (earliest scheduled time in the group)
    const startTime = filtered.length > 0 ? filtered[0].scheduled_send_time : undefined;
    onReorder(newOrder, startTime);
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="bg-surface border border-border rounded-lg p-4 md:p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base md:text-lg font-semibold text-text flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-accent" />
              Scheduled ({allScheduled.length})
            </h3>
            {queue.length > 0 && (
              <p className="text-xs text-text-muted mt-0.5">{queue.length} contacts waiting for next email</p>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Campaign filter */}
            <div className="relative flex-1 sm:flex-none">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-dim" />
              <select
                value={campaignFilter ?? ''}
                onChange={e => setCampaignFilter(e.target.value ? Number(e.target.value) : null)}
                className="pl-8 pr-3 py-2 bg-bg border border-border rounded-lg text-xs md:text-sm text-text w-full sm:w-auto appearance-none cursor-pointer"
              >
                <option value="">All Campaigns</option>
                {campaigns.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={onReviewInTabs}
              disabled={allScheduled.length === 0 || isReviewLaunching}
              className="flex items-center justify-center gap-1.5 px-3 py-2 border border-border bg-bg text-text rounded-lg text-xs md:text-sm font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isReviewLaunching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
              Review in Tabs
            </button>
            <button
              onClick={onSendAll}
              disabled={allScheduled.length === 0 || isSending}
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-accent text-white rounded-lg text-xs md:text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Process Due
            </button>
          </div>
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 mb-4 p-2.5 bg-accent/5 border border-accent/20 rounded-lg">
            <span className="text-xs font-medium text-accent">{selectedIds.size} selected</span>
            <button className="text-xs text-text-muted hover:text-text px-2 py-1 rounded hover:bg-surface transition-colors">
              Reschedule
            </button>
            <button className="text-xs text-text-muted hover:text-text px-2 py-1 rounded hover:bg-surface transition-colors">
              Pause
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs text-text-dim hover:text-text-muted transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        {/* Timeline */}
        {allScheduled.length === 0 ? (
          <div className="text-center py-10 md:py-12 text-text-muted">
            <CalendarClock className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm md:text-base">No scheduled emails</p>
            <p className="text-xs md:text-sm mt-1">Approve emails from the Review tab to schedule them</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-5">
                {groups.map(group => (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-[10px] md:text-xs font-semibold text-text-muted uppercase tracking-wider">
                        {group.label}
                      </h4>
                      <span className="text-[10px] text-text-dim">({group.emails.length})</span>
                      <div className="flex-1 border-t border-border ml-2" />
                    </div>
                    <div className="space-y-1">
                      {group.emails.map(email => (
                        <SortableEmailRow
                          key={email.id}
                          email={email}
                          onView={() => onViewEmail(email)}
                          onEdit={() => onEditEmail(email)}
                          onSendNow={() => onSendNow(email.id)}
                          onReschedule={() => onReschedule(email)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Waiting for next email section (contacts not yet scheduled) */}
      {queue.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4 md:p-5">
          <h3 className="text-sm md:text-base font-semibold text-text mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-text-muted" />
            Waiting for Next Email ({queue.length})
          </h3>
          <div className="space-y-1">
            {queue.slice(0, 20).map(contact => (
              <div key={contact.id} className="flex items-center justify-between gap-3 px-3 md:px-4 py-2.5 bg-bg rounded-lg">
                <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                  <div className="w-6 h-6 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-medium text-accent">{contact.current_step + 1}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-text text-xs md:text-sm truncate">{contact.contact_name}</p>
                    <p className="text-[10px] md:text-xs text-text-muted truncate">{contact.company_name}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs md:text-sm text-text tabular-nums">
                    {contact.next_email_at ? new Date(contact.next_email_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ready'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
