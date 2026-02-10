import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Mail, Plus, Search, SlidersHorizontal, ChevronDown, ChevronRight, X } from 'lucide-react';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { CampaignCard } from './CampaignCard';
import type { EmailCampaign, CampaignScheduleSummary } from '../../types/email';

type CampaignsViewProps = {
  campaigns: EmailCampaign[];
  campaignScheduleSummary: CampaignScheduleSummary[];
  isLoading: boolean;
  onCreateCampaign: () => void;
  onEditTemplates: (campaign: EmailCampaign) => void;
  onDelete: (campaignId: number) => void;
  onActivate: (campaignId: number) => void;
  onPause: (campaignId: number) => void;
  onViewContacts: () => void;
  onSendEmails: (campaignId: number) => void;
  onUploadToSalesforce: (campaignId: number) => void;
  uploadingCampaignId: number | null;
};

type StatusFilter = 'all' | 'active' | 'paused' | 'completed' | 'draft';
type SortOption = 'recent' | 'name' | 'contacts' | 'next_send';

function sortCampaigns(
  campaigns: EmailCampaign[],
  sort: SortOption,
  summaries: CampaignScheduleSummary[]
): EmailCampaign[] {
  const summaryMap = new Map(summaries.map(s => [s.campaign_id, s]));
  const sorted = [...campaigns];

  switch (sort) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'contacts':
      sorted.sort((a, b) => (b.stats?.total_contacts || 0) - (a.stats?.total_contacts || 0));
      break;
    case 'next_send': {
      sorted.sort((a, b) => {
        const aTime = summaryMap.get(a.id)?.next_send_time;
        const bTime = summaryMap.get(b.id)?.next_send_time;
        if (!aTime && !bTime) return 0;
        if (!aTime) return 1;
        if (!bTime) return -1;
        return new Date(aTime).getTime() - new Date(bTime).getTime();
      });
      break;
    }
    case 'recent':
    default: {
      sorted.sort((a, b) => {
        const aLast = summaryMap.get(a.id)?.last_sent_at;
        const bLast = summaryMap.get(b.id)?.last_sent_at;
        if (!aLast && !bLast) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (!aLast) return 1;
        if (!bLast) return -1;
        return new Date(bLast).getTime() - new Date(aLast).getTime();
      });
      break;
    }
  }
  return sorted;
}

/* ── Section header ────────────────────────────────── */

function SectionHeader({
  title,
  count,
  color,
  collapsed,
  onToggle
}: {
  title: string;
  count: number;
  color: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 py-2 group"
    >
      {collapsed ? (
        <ChevronRight className="w-4 h-4 text-text-dim group-hover:text-text-muted transition-colors" />
      ) : (
        <ChevronDown className="w-4 h-4 text-text-dim group-hover:text-text-muted transition-colors" />
      )}
      <span className={`text-xs md:text-sm font-semibold uppercase tracking-wider ${color}`}>
        {title}
      </span>
      <span className="text-xs text-text-dim">({count})</span>
      <div className="flex-1 border-t border-border ml-2" />
    </button>
  );
}

/* ── Main component ────────────────────────────────── */

export function CampaignsView({
  campaigns,
  campaignScheduleSummary,
  isLoading,
  onCreateCampaign,
  onEditTemplates,
  onDelete,
  onActivate,
  onPause,
  onViewContacts,
  onSendEmails,
  onUploadToSalesforce,
  uploadingCampaignId
}: CampaignsViewProps) {
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [searchRaw, setSearchRaw] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const searchRef = useRef<HTMLInputElement>(null);

  // Collapse state persisted in localStorage
  const [completedCollapsed, setCompletedCollapsed] = useState(() => {
    try { return localStorage.getItem('email_completed_collapsed') !== 'false'; }
    catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem('email_completed_collapsed', String(completedCollapsed)); }
    catch { /* noop */ }
  }, [completedCollapsed]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(searchRaw.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchRaw]);

  // Keyboard shortcut: '/' to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Filter and sort
  const { activeCampaigns, pausedCampaigns, completedCampaigns, draftCampaigns, filteredCount } = useMemo(() => {
    let filtered = campaigns;

    // Text search
    if (searchDebounced) {
      const q = searchDebounced;
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(c => c.status === statusFilter);
    }

    // Sort
    const sorted = sortCampaigns(filtered, sortBy, campaignScheduleSummary);

    return {
      activeCampaigns: sorted.filter(c => c.status === 'active'),
      pausedCampaigns: sorted.filter(c => c.status === 'paused'),
      completedCampaigns: sorted.filter(c => c.status === 'completed'),
      draftCampaigns: sorted.filter(c => c.status === 'draft'),
      filteredCount: sorted.length
    };
  }, [campaigns, searchDebounced, statusFilter, sortBy, campaignScheduleSummary]);

  const renderCard = useCallback((campaign: EmailCampaign) => (
    <CampaignCard
      key={campaign.id}
      campaign={campaign}
      scheduleSummary={campaignScheduleSummary.find(s => s.campaign_id === campaign.id)}
      onEditTemplates={() => onEditTemplates(campaign)}
      onDelete={() => setDeleteId(campaign.id)}
      onActivate={() => onActivate(campaign.id)}
      onPause={() => onPause(campaign.id)}
      onViewContacts={onViewContacts}
      onSendEmails={() => onSendEmails(campaign.id)}
      onUploadToSalesforce={() => onUploadToSalesforce(campaign.id)}
      isUploading={uploadingCampaignId === campaign.id}
    />
  ), [campaignScheduleSummary, onEditTemplates, onActivate, onPause, onViewContacts, onSendEmails, onUploadToSalesforce, uploadingCampaignId, onDelete]);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-12 md:py-20">
        <Mail className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-3 md:mb-4 text-text-dim opacity-50" />
        <h3 className="text-base md:text-lg font-medium text-text mb-2">No campaigns yet</h3>
        <p className="text-xs md:text-sm text-text-muted mb-3 md:mb-4 px-4">Create your first email campaign to get started</p>
        <button
          onClick={onCreateCampaign}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Campaign
        </button>
      </div>
    );
  }

  const hasFilters = searchDebounced || statusFilter !== 'all';
  const noResults = hasFilters && filteredCount === 0;

  return (
    <>
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
          <input
            ref={searchRef}
            type="text"
            value={searchRaw}
            onChange={e => setSearchRaw(e.target.value)}
            placeholder="Search campaigns...  (/)"
            className="w-full pl-9 pr-8 py-2 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent transition-colors"
          />
          {searchRaw && (
            <button
              onClick={() => setSearchRaw('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-surface-hover rounded transition-colors"
            >
              <X className="w-3.5 h-3.5 text-text-dim" />
            </button>
          )}
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2">
          {/* Status filter */}
          <div className="relative">
            <SlidersHorizontal className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-dim pointer-events-none" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
              className="pl-8 pr-7 py-2 bg-bg border border-border rounded-lg text-xs md:text-sm text-text appearance-none cursor-pointer focus:outline-none focus:border-accent"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="draft">Draft</option>
            </select>
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortOption)}
            className="px-3 py-2 bg-bg border border-border rounded-lg text-xs md:text-sm text-text appearance-none cursor-pointer focus:outline-none focus:border-accent"
          >
            <option value="recent">Recent Activity</option>
            <option value="name">Name</option>
            <option value="contacts">Contacts</option>
            <option value="next_send">Next Send</option>
          </select>
        </div>
      </div>

      {/* No results */}
      {noResults && (
        <div className="text-center py-10 md:py-14">
          <Search className="w-10 h-10 mx-auto mb-3 text-text-dim opacity-50" />
          <h3 className="text-sm md:text-base font-medium text-text mb-1">
            No campaigns match{searchDebounced ? ` "${searchDebounced}"` : ''}
          </h3>
          <p className="text-xs text-text-muted mb-3">
            {statusFilter !== 'all'
              ? `Try changing the status filter or clearing your search`
              : 'Try a different search term'}
          </p>
          <button
            onClick={() => { setSearchRaw(''); setStatusFilter('all'); }}
            className="text-xs text-accent hover:text-accent-hover font-medium"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Campaign sections */}
      {!noResults && (
        <div className="space-y-2">
          {/* When using a status filter, show a flat grid */}
          {statusFilter !== 'all' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[...activeCampaigns, ...pausedCampaigns, ...completedCampaigns, ...draftCampaigns].map(renderCard)}
            </div>
          ) : (
            <>
              {/* Active Campaigns */}
              {activeCampaigns.length > 0 && (
                <div>
                  <SectionHeader
                    title="Active Campaigns"
                    count={activeCampaigns.length}
                    color="text-green-700"
                    collapsed={false}
                    onToggle={() => {}}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeCampaigns.map(renderCard)}
                  </div>
                </div>
              )}

              {/* Paused Campaigns */}
              {pausedCampaigns.length > 0 && (
                <div>
                  <SectionHeader
                    title="Paused Campaigns"
                    count={pausedCampaigns.length}
                    color="text-amber-700"
                    collapsed={false}
                    onToggle={() => {}}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {pausedCampaigns.map(renderCard)}
                  </div>
                </div>
              )}

              {/* Draft Campaigns */}
              {draftCampaigns.length > 0 && (
                <div>
                  <SectionHeader
                    title="Draft Campaigns"
                    count={draftCampaigns.length}
                    color="text-text-muted"
                    collapsed={false}
                    onToggle={() => {}}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {draftCampaigns.map(renderCard)}
                  </div>
                </div>
              )}

              {/* Completed Campaigns - collapsible */}
              {completedCampaigns.length > 0 && (
                <div>
                  <SectionHeader
                    title="Completed Campaigns"
                    count={completedCampaigns.length}
                    color="text-blue-700"
                    collapsed={completedCollapsed}
                    onToggle={() => setCompletedCollapsed(prev => !prev)}
                  />
                  {!completedCollapsed && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {completedCampaigns.map(renderCard)}
                    </div>
                  )}
                </div>
              )}

              {/* Show create prompt if only completed or no active */}
              {activeCampaigns.length === 0 && pausedCampaigns.length === 0 && draftCampaigns.length === 0 && (
                <div className="text-center py-8 border border-dashed border-border rounded-lg">
                  <p className="text-sm text-text-muted mb-2">No active campaigns</p>
                  <button
                    onClick={onCreateCampaign}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create Campaign
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete campaign?"
        message="This campaign and all its email data will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteId !== null) onDelete(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </>
  );
}
