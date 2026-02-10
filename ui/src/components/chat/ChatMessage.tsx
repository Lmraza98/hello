import {
  Building2,
  CalendarCheck,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  Download,
  ExternalLink,
  Eye,
  FolderPlus,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import type {
  BackgroundTask,
  ChatMessage as ChatMessageType,
  CompanyVetCardMessage,
  ContactAction,
  DashboardDataBridge,
  EmbeddedComponentMessage,
} from '../../types/chat';
import { MetricPill } from '../dashboard/MetricPill';
import { ActiveConversationsCard } from '../dashboard/ActiveConversationsCard';
import { ScheduledSendsCard } from '../dashboard/ScheduledSendsCard';
import { MiniLineChart } from '../dashboard/MiniLineChart';
import { LiveContacts } from '../dashboard/LiveContacts';

interface ChatMessageProps {
  message: ChatMessageType;
  onAction: (actionValue: string) => void;
  onSalesforceSaveUrl?: (contactId: number, contactName: string, url: string, promptId: string) => Promise<void>;
  onSalesforceSearch?: (contactId: number, contactName: string, promptId: string) => Promise<void>;
  onSalesforceSkip?: (contactId: number, promptId: string) => Promise<void>;
  dashboardData?: DashboardDataBridge;
}

const actionButtonClasses: Record<string, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border-transparent',
  secondary: 'bg-surface text-text border-border hover:bg-surface-hover',
  danger: 'bg-red-600 text-white hover:bg-red-700 border-transparent',
};

export function ChatMessage({
  message,
  onAction,
  onSalesforceSaveUrl,
  onSalesforceSearch,
  onSalesforceSkip,
  dashboardData,
}: ChatMessageProps) {
  switch (message.type) {
    case 'status':
      return <StatusBlock message={message} />;
    case 'sf_url_prompt':
      return (
        <BotBubble compact>
          <SalesforceUrlPrompt
            promptId={message.id}
            contactId={message.contact.id}
            contactName={message.contact.name}
            onSaveUrl={onSalesforceSaveUrl}
            onSearch={onSalesforceSearch}
            onSkip={onSalesforceSkip}
          />
        </BotBubble>
      );
    case 'action_buttons': {
      const isContactFollowUp = /add this contact/i.test(message.content);
      return (
        <BotBubble compact={isContactFollowUp}>
          <p className="text-xs text-text-muted">{message.content}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.buttons.map((button) => (
              <button
                key={button.value}
                type="button"
                onClick={() => onAction(`${button.value}::src=${message.id}`)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                  actionButtonClasses[button.variant]
                }`}
              >
                {button.label}
              </button>
            ))}
          </div>
        </BotBubble>
      );
    }
    case 'contact_card':
      return <ContactCardRenderer message={message} onAction={onAction} />;
    case 'email_preview':
      return (
        <BotBubble>
          <div className="space-y-2">
            <p className="text-xs text-text-dim">To: {message.email.to}</p>
            <p className="text-sm font-semibold text-text">{message.email.subject}</p>
            <p className="line-clamp-6 whitespace-pre-wrap text-sm text-text-muted">{message.email.body}</p>
            <div className="flex flex-wrap gap-2">
              {message.actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => onAction(action)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    action === 'approve'
                      ? actionButtonClasses.primary
                      : action === 'discard'
                        ? actionButtonClasses.danger
                        : actionButtonClasses.secondary
                  }`}
                >
                  {action === 'approve'
                    ? 'Approve'
                    : action === 'discard'
                      ? 'Discard'
                      : 'Edit'}
                </button>
              ))}
            </div>
          </div>
        </BotBubble>
      );
    case 'campaign_list':
      return (
        <BotBubble>
          <div className="space-y-2">
            {message.prompt ? (
              <p className="text-sm text-text">{message.prompt}</p>
            ) : null}
            <div className="space-y-1">
              {message.campaigns.map((campaign) =>
                message.selectable ? (
                  <button
                    key={campaign.id}
                    type="button"
                    onClick={() => onAction(String(campaign.id))}
                    className="flex w-full items-center justify-between rounded-md border border-border bg-bg px-2.5 py-2 text-left text-xs hover:bg-surface-hover"
                  >
                    <span className="text-text">{campaign.name}</span>
                    <span className="text-text-dim">{campaign.status}</span>
                  </button>
                ) : (
                  <div
                    key={campaign.id}
                    className="flex items-center justify-between rounded-md border border-border bg-bg px-2.5 py-2 text-xs"
                  >
                    <span className="text-text">{campaign.name}</span>
                    <span className="text-text-dim">
                      {campaign.status} - {campaign.contact_count} contacts
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        </BotBubble>
      );
    case 'conversation_card':
      return (
        <BotBubble>
          <div className="space-y-2">
            <div>
              <p className="text-sm font-semibold text-text">
                {message.conversation.contact_name}
              </p>
              <p className="text-xs text-text-dim">{message.conversation.company_name}</p>
            </div>
            <p className="text-xs text-text-muted">{message.conversation.snippet}</p>
            <p className="text-[11px] text-text-dim">
              {new Date(message.conversation.received_at).toLocaleString()}
            </p>
            {message.conversation.sentiment ? (
              <span className="inline-flex rounded bg-surface-hover px-2 py-0.5 text-[11px] text-text-dim">
                {message.conversation.sentiment}
              </span>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {message.actions.includes('view') ? (
                <button
                  type="button"
                  onClick={() => onAction(`view:${message.conversation.reply_id}`)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-hover"
                >
                  <Eye className="h-3 w-3" />
                  View
                </button>
              ) : null}
              {message.actions.includes('mark_done') ? (
                <button
                  type="button"
                  onClick={() => onAction(`mark_done:${message.conversation.reply_id}`)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-hover"
                >
                  <Check className="h-3 w-3" />
                  Mark Done
                </button>
              ) : null}
            </div>
          </div>
        </BotBubble>
      );
    case 'company_list':
      return (
        <BotBubble>
          <div className="space-y-2">
            {message.prompt ? (
              <p className="text-xs font-medium text-text">{message.prompt}</p>
            ) : null}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {message.companies.map((company, idx) => (
                <div
                  key={`${company.company_name}-${idx}`}
                  className="flex items-center justify-between rounded-md border border-border bg-bg px-2.5 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Building2 className="h-3 w-3 text-indigo-500 shrink-0" />
                      <span className="font-medium text-text truncate">{company.company_name}</span>
                    </div>
                    {(company.industry || company.location) && (
                      <p className="text-[11px] text-text-dim mt-0.5 pl-[18px]">
                        {[company.industry, company.location].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  {company.employee_count && (
                    <span className="text-[11px] text-text-dim shrink-0 ml-2">
                      {company.employee_count}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </BotBubble>
      );
    case 'company_vet_card':
      return <CompanyVetCardRenderer message={message} onAction={onAction} />;
    case 'background_task':
      return <BackgroundTaskRenderer task={message.task} />;
    case 'embedded_component':
      return (
        <EmbeddedComponentRenderer
          message={message}
          onAction={onAction}
          dashboardData={dashboardData}
        />
      );
    case 'text':
    default: {
      const isUser = message.sender === 'user';
      return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
              isUser
                ? 'bg-accent text-white'
                : 'border border-border bg-surface text-text'
            }`}
          >
            <span className="whitespace-pre-wrap">{renderBoldText(message.content)}</span>
          </div>
        </div>
      );
    }
  }
}

/* ── Contact Card with Actions ── */

const contactActionConfig: Record<ContactAction, { label: string; icon: React.ElementType; variant: 'primary' | 'secondary' }> = {
  add_to_campaign: { label: 'Add to Campaign', icon: FolderPlus, variant: 'primary' },
  send_email: { label: 'Email', icon: Mail, variant: 'primary' },
  view_in_salesforce: { label: 'View in SF', icon: ExternalLink, variant: 'secondary' },
  edit_contact: { label: 'Edit', icon: Pencil, variant: 'secondary' },
  search_salesnav: { label: 'Search Sales Nav', icon: Search, variant: 'primary' },
  add_to_database: { label: 'Add to Database', icon: Plus, variant: 'primary' },
  sync_salesforce: { label: 'Sync to SF', icon: RefreshCw, variant: 'primary' },
};

function ContactCardRenderer({
  message,
  onAction,
}: {
  message: Extract<ChatMessageType, { type: 'contact_card' }>;
  onAction: (actionValue: string) => void;
}) {
  const { contact, actions } = message;

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-lg border border-border bg-surface overflow-hidden">
        {/* Contact info */}
        <div className="px-2.5 py-2">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold leading-5 text-text">{contact.name}</p>
            <p className="text-xs leading-4 text-text-muted">
              {[contact.title, contact.company].filter(Boolean).join(' - ')}
            </p>
            {contact.email ? (
              <p className="text-xs leading-4 text-text">{contact.email}</p>
            ) : null}
            {contact.location ? (
              <p className="text-xs leading-4 text-text-dim">{contact.location}</p>
            ) : null}
            {contact.linkedin_url ? (
              <a
                href={ensureProtocol(contact.linkedin_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 pt-0.5 text-xs text-accent hover:text-accent-hover"
              >
                LinkedIn <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            {contact.source ? (
              <p className="pt-0.5 text-[11px] leading-4 text-text-dim">Source: {contact.source}</p>
            ) : null}
          </div>
        </div>

        {/* Action buttons */}
        {actions && actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2.5 pb-2 border-t border-border pt-2">
            {actions.map((action) => {
              const cfg = contactActionConfig[action];
              if (!cfg) return null;
              const Icon = cfg.icon;
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => onAction(`contact_action:${action}:${contact.id ?? 0}`)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
                    cfg.variant === 'primary'
                      ? 'bg-accent text-white hover:bg-accent-hover'
                      : 'bg-surface border border-border text-text-muted hover:bg-surface-hover hover:text-text'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Embedded Dashboard Components ── */

function EmbeddedComponentRenderer({
  message,
  onAction: _onAction,
  dashboardData,
}: {
  message: EmbeddedComponentMessage;
  onAction: (v: string) => void;
  dashboardData?: DashboardDataBridge;
}) {
  void _onAction; // reserved for future context actions on embedded components
  const { componentType } = message;
  const d = dashboardData;

  switch (componentType) {
    case 'overview':
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium text-text">Overview</span>
          </div>
          <div className="p-3 bg-surface">
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-px bg-border rounded-lg overflow-hidden">
              <MetricPill icon={Building2} label="Companies" value={d?.stats?.total_companies ?? 0} color="text-indigo-600" />
              <MetricPill icon={Users} label="Contacts" value={d?.stats?.total_contacts ?? 0} color="text-blue-600" />
              <MetricPill icon={Percent} label="Reply" value={`${d?.replyRate ?? 0}%`} color="text-green-600" />
              <MetricPill icon={CalendarCheck} label="Meetings" value={(d?.meetingRate ?? 0) > 0 ? `${d?.meetingRate}%` : '0'} color="text-emerald-600" />
              <MetricPill icon={MessageCircle} label="Active" value={d?.activeConversations ?? 0} color="text-amber-600" highlight={(d?.activeConversations ?? 0) > 0} />
            </div>
          </div>
        </div>
      );

    case 'active_conversations':
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-text">Active Conversations</span>
            {(d?.activeConversations ?? 0) > 0 && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                {d?.activeConversations}
              </span>
            )}
          </div>
          <div className="bg-surface">
            {d ? (
              <ActiveConversationsCard
                activeConversations={d.activeConversations}
                recentReplies={d.recentReplies}
                outlookConnected={d.outlookConnected}
                pollReplies={d.pollReplies}
                pollRepliesLoading={d.pollRepliesLoading}
                disconnectOutlook={d.disconnectOutlook}
                onSelectConversation={d.onSelectConversation}
                onMarkDone={d.onMarkDone}
                removingIds={d.removingIds}
              />
            ) : (
              <div className="p-4 text-xs text-text-dim text-center">No data available</div>
            )}
          </div>
        </div>
      );

    case 'scheduled_sends':
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium text-text">Scheduled Sends</span>
            {(d?.nextSends?.length ?? 0) > 0 && (
              <span className="text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                {d?.nextSends.length} today
              </span>
            )}
          </div>
          <div className="bg-surface">
            {d ? (
              <ScheduledSendsCard nextSends={d.nextSends} totalScheduled={d.totalScheduled} />
            ) : (
              <div className="p-4 text-xs text-text-dim text-center">No data available</div>
            )}
          </div>
        </div>
      );

    case 'email_performance':
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-2">
            <Mail className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium text-text">Email Performance</span>
            {(d?.daily?.length ?? 0) > 0 && (
              <span className="ml-0.5 text-[10px] text-text-dim">({d?.daily.length}d)</span>
            )}
          </div>
          <div className="p-3 bg-surface">
            {(d?.daily?.length ?? 0) > 1 ? (
              <MiniLineChart data={d!.daily} />
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-text-dim">
                <Mail className="mb-2 h-6 w-6 opacity-30" />
                <p className="text-xs">Send your first campaign to see trends</p>
              </div>
            )}
          </div>
        </div>
      );

    case 'todays_contacts': {
      const contacts = d?.todaysContacts ?? [];
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-surface border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-accent" />
              <span className="text-sm font-medium text-text">Today's Contacts</span>
              {contacts.length > 0 && (
                <span className="text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                  {contacts.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => d?.onExportContacts?.()}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text transition-colors"
                title="Export today's contacts"
              >
                <Download className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => d?.onClearContacts?.()}
                className="flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 transition-colors"
                title="Clear today's contacts"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="bg-surface">
            <LiveContacts contacts={contacts} />
          </div>
        </div>
      );
    }

    case 'background_tasks': {
      // Rendered inline when user clicks a section with running tasks
      // This is a placeholder that shows task monitoring
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-accent animate-spin" />
            <span className="text-sm font-medium text-text">Background Tasks</span>
          </div>
          <div className="p-3 bg-surface text-xs text-text-muted">
            <p>Active tasks will appear here. Type <strong>"check job status"</strong> for details.</p>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

/* ── Company Vet Card ── */

function CompanyVetCardRenderer({
  message,
  onAction,
}: {
  message: CompanyVetCardMessage;
  onAction: (v: string) => void;
}) {
  const { company, research, position, actions, existing } = message;
  const [showSources, setShowSources] = useState(false);

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-lg border border-border bg-surface overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-border">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${(position.current / position.total) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-text-dim" />
            <span className="text-sm font-semibold text-text">{company.name}</span>
            {company.headcount && (
              <span className="text-[10px] text-text-dim bg-bg px-1.5 py-0.5 rounded">
                {company.headcount}
              </span>
            )}
            {existing && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                In DB
              </span>
            )}
          </div>
          <span className="text-[10px] text-text-dim">
            {position.current} of {position.total} &middot; {position.approved_so_far} approved
          </span>
        </div>

        {/* Existing company info banner */}
        {existing && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <div className="text-[11px] text-amber-800">
              <span className="font-medium">Already collected</span>
              <span className="mx-1">&middot;</span>
              <span>{existing.contact_count} contact{existing.contact_count !== 1 ? 's' : ''}</span>
              {existing.vetted_at && (
                <>
                  <span className="mx-1">&middot;</span>
                  <span>Vetted {new Date(existing.vetted_at).toLocaleDateString()}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Company info */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex flex-wrap gap-2 text-xs text-text-muted">
            {company.industry && (
              <span className="bg-bg px-2 py-0.5 rounded">{company.industry}</span>
            )}
            {company.hq_location && (
              <span className="bg-bg px-2 py-0.5 rounded">{company.hq_location}</span>
            )}
            {company.website && (
              <a
                href={ensureProtocol(company.website)}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-bg px-2 py-0.5 rounded text-accent hover:text-accent-hover"
              >
                Website
              </a>
            )}
            {company.linkedin_url && (
              <a
                href={ensureProtocol(company.linkedin_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-bg px-2 py-0.5 rounded text-accent hover:text-accent-hover"
              >
                LinkedIn
              </a>
            )}
          </div>

          {company.description && (
            <p className="text-xs text-text-muted leading-relaxed">{company.description}</p>
          )}

          {/* Research results */}
          {research && Object.keys(research).length > 0 && (
            <div className="mt-2 space-y-2">
              {research.website_summary && (
                <div className="text-xs text-text-muted bg-bg rounded-lg p-2.5">
                  <span className="font-medium text-text text-[11px]">Overview: </span>
                  {research.website_summary}
                </div>
              )}

              {research.services_relevance && (
                <div className="text-xs text-blue-700 bg-blue-50 rounded-lg p-2.5">
                  <span className="font-medium text-[11px]">Relevance: </span>
                  {research.services_relevance}
                </div>
              )}

              {/* ICP Fit Score */}
              {research.icp_fit_score != null && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-medium text-text">ICP Fit:</span>
                    <ICPScoreBadge score={research.icp_fit_score} />
                  </div>
                  {research.icp_fit_reasoning && (
                    <span className="text-[10px] text-text-dim flex-1">
                      {research.icp_fit_reasoning}
                    </span>
                  )}
                </div>
              )}

              {research.recent_news && research.recent_news.length > 0 && (
                <div className="text-xs text-text-dim">
                  <span className="font-medium text-text text-[11px]">Recent News: </span>
                  {research.recent_news.slice(0, 2).join(' · ')}
                </div>
              )}

              {research.talking_points && research.talking_points.length > 0 && (
                <div className="text-xs text-text-dim">
                  <span className="font-medium text-text text-[11px]">Talking Points: </span>
                  {research.talking_points.slice(0, 2).join('; ')}
                </div>
              )}

              {/* Source links from Tavily */}
              {research.sources && research.sources.length > 0 && (
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setShowSources(!showSources)}
                    className="text-[10px] text-accent hover:text-accent-hover font-medium"
                  >
                    {showSources ? 'Hide' : 'Show'} {research.sources.length} source{research.sources.length !== 1 ? 's' : ''}
                  </button>
                  {showSources && (
                    <div className="mt-1.5 space-y-1">
                      {research.sources.map((src: { title: string; url: string; snippet?: string }, i: number) => (
                        <a
                          key={i}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-start gap-1.5 text-[11px] text-accent hover:text-accent-hover group"
                        >
                          <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 opacity-50 group-hover:opacity-100" />
                          <span className="line-clamp-1">{src.title || src.url}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border bg-bg">
          {actions.includes('approve') && (
            <button
              type="button"
              onClick={() => onAction('approve')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Check className="w-3 h-3" /> {existing ? 'Re-add' : 'Add'}
            </button>
          )}
          {actions.includes('skip') && (
            <button
              type="button"
              onClick={() => onAction('skip')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface border border-border text-text-muted rounded-lg hover:bg-surface-hover transition-colors"
            >
              <X className="w-3 h-3" /> Skip
            </button>
          )}
          {actions.includes('more_info') && (
            <button
              type="button"
              onClick={() => onAction('more_info')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent border border-accent/20 rounded-lg hover:bg-accent/5 transition-colors"
            >
              <Search className="w-3 h-3" /> More Info
            </button>
          )}
          <div className="flex-1" />
          {actions.includes('skip_rest') && (
            <button
              type="button"
              onClick={() => onAction('skip_rest')}
              className="px-2 py-1.5 text-[11px] text-text-dim hover:text-text transition-colors"
            >
              Skip remaining &rarr;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ICPScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8
      ? 'bg-green-100 text-green-700'
      : score >= 6
        ? 'bg-yellow-100 text-yellow-700'
        : score >= 4
          ? 'bg-orange-100 text-orange-700'
          : 'bg-red-100 text-red-700';

  return (
    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${color}`}>
      {score}/10
    </span>
  );
}

/* ── Background Task Renderer ── */

function BackgroundTaskRenderer({ task }: { task: BackgroundTask }) {
  const isRunning = task.status === 'running';
  const progress = task.progress
    ? Math.round((task.progress.current / task.progress.total) * 100)
    : 0;

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-lg border border-border bg-surface overflow-hidden">
        <div className="px-3 py-2.5 flex items-center gap-2">
          {isRunning ? (
            <Loader2 className="w-4 h-4 text-accent animate-spin" />
          ) : task.status === 'completed' ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
          <span className="text-sm font-medium text-text">{task.label}</span>
        </div>

        {task.progress && (
          <div className="px-3 pb-2">
            <div className="h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isRunning ? 'bg-accent animate-pulse' : 'bg-green-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[10px] text-text-dim mt-1">
              {task.progress.current} of {task.progress.total}
              {isRunning ? ' — in progress' : ' — done'}
            </p>
          </div>
        )}

        {task.details && task.details.length > 0 && (
          <div className="px-3 pb-2.5 space-y-0.5">
            {task.details.slice(-5).map((detail, i) => (
              <p key={i} className="text-[11px] text-text-dim">
                {detail}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Helpers ── */

function BotBubble({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[90%] rounded-xl border border-border bg-surface ${
          compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function StatusBlock({
  message,
}: {
  message: Extract<ChatMessageType, { type: 'status' }>;
}) {
  const statusToStyle = {
    loading: {
      className: 'border-amber-300 bg-amber-50 text-amber-800',
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
    },
    success: {
      className: 'border-green-300 bg-green-50 text-green-800',
      icon: <CheckCircle2 className="h-4 w-4" />,
    },
    error: {
      className: 'border-red-300 bg-red-50 text-red-800',
      icon: <XCircle className="h-4 w-4" />,
    },
    info: {
      className: 'border-blue-300 bg-blue-50 text-blue-800',
      icon: <Info className="h-4 w-4" />,
    },
  } as const;

  const style = statusToStyle[message.status];
  return (
    <div className="flex justify-start">
      <div
        className={`inline-flex items-center gap-2 rounded-md border-l-4 border px-3 py-2 text-xs ${style.className}`}
      >
        {style.icon}
        <span>{message.content}</span>
      </div>
    </div>
  );
}

function renderBoldText(content: string) {
  const parts = content.split(/(\*\*.*?\*\*)/g).filter(Boolean);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={`${part}-${idx}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${part}-${idx}`}>{part}</span>;
  });
}

function ensureProtocol(url: string): string {
  if (!url) return url;
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;

  // Handle LinkedIn relative paths like "/in/..." or "/sales/lead/..."
  if (trimmed.startsWith('/')) {
    return `https://www.linkedin.com${trimmed}`;
  }

  // Handle missing protocol with full host, e.g. "www.linkedin.com/in/..."
  if (/^(www\.)?linkedin\.com\//i.test(trimmed)) {
    return `https://${trimmed.replace(/^www\./i, 'www.')}`;
  }

  // Fallback: treat as a bare host/path.
  return `https://${trimmed}`;
}

function SalesforceUrlPrompt({
  promptId,
  contactId,
  contactName,
  onSaveUrl,
  onSearch,
  onSkip,
}: {
  promptId: string;
  contactId: number;
  contactName: string;
  onSaveUrl?: (contactId: number, contactName: string, url: string, promptId: string) => Promise<void>;
  onSearch?: (contactId: number, contactName: string, promptId: string) => Promise<void>;
  onSkip?: (contactId: number, promptId: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'default' | 'paste'>('default');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const validateSalesforceLeadUrl = (value: string) => {
    const v = value.trim();
    if (!v) return 'Paste a URL first.';
    if (!v.includes('lightning.force.com') || !v.includes('/lightning/r/Lead/')) {
      return 'That does not look like a Salesforce Lead URL.';
    }
    return null;
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-xs text-text">
          <span className="font-medium">{contactName}</span> saved to your database.
        </p>
        <p className="text-xs text-text-muted">Does this contact already have a Salesforce URL?</p>
      </div>

      {mode === 'paste' ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="Paste Salesforce Lead URL..."
              className="h-8 w-full rounded-md border border-border bg-bg px-2 text-xs text-text outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                const err = validateSalesforceLeadUrl(url);
                if (err) {
                  setError(err);
                  return;
                }
                if (!onSaveUrl) {
                  setError('Save is not available in this view.');
                  return;
                }
                setSaving(true);
                try {
                  await onSaveUrl(contactId, contactName, url.trim(), promptId);
                } finally {
                  setSaving(false);
                }
              }}
              className="h-8 shrink-0 rounded-md border border-transparent bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setMode('default');
                setUrl('');
                setError(null);
              }}
              className="h-8 shrink-0 rounded-md border border-border bg-bg px-2.5 text-[11px] font-medium text-text hover:bg-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setMode('paste')}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-hover"
          >
            Paste URL
          </button>
          <button
            type="button"
            onClick={() => onSearch?.(contactId, contactName, promptId)}
            className="inline-flex items-center gap-1 rounded-md border border-transparent bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hover"
          >
            <Cloud className="h-3 w-3" />
            Search Salesforce
          </button>
          <button
            type="button"
            onClick={() => onSkip?.(contactId, promptId)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-hover"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
