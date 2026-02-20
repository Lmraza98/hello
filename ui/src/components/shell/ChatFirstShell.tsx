import { useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  Clock3,
  Dot,
  FileCode2,
  FolderOpen,
  LayoutDashboard,
  Mail,
  Menu,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Shield,
  Users,
  Zap,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ChatDock } from '../chat/ChatDock';
import { SettingsModal } from '../settings/SettingsModal';
import type { AppShellOutletContext, AppShellQuickAddTarget } from './appShellContext';
import { useWorkspaceLayout } from './workspaceLayout';
import { ContextualInteractionPanel } from './ContextualInteractionPanel';
import { WorkspaceSurface } from './WorkspaceSurface';

export function ChatFirstShell() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useWorkspaceLayout();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openAddModalTarget, setOpenAddModalTarget] = useState<AppShellQuickAddTarget>(null);
  const [chatExpanded, setChatExpanded] = useState(true);
  const [chatCollapseSignal, setChatCollapseSignal] = useState(0);
  const quickAddRef = useRef<HTMLDivElement>(null);
  const hideDockOnContacts = location.pathname.startsWith('/contacts');

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 5000,
  });
  const { data: activeBrowserTasks } = useQuery({
    queryKey: ['browser', 'activeTaskCount', 'nav'],
    queryFn: () => api.getBrowserWorkflowTasks({ includeFinished: false, limit: 1 }),
    refetchInterval: 2000,
  });
  const { data: activeCompoundTasks } = useQuery({
    queryKey: ['compound', 'activeTaskCount', 'nav'],
    queryFn: () => api.getCompoundWorkflows({ status: 'running', limit: 1 }),
    refetchInterval: 2000,
  });
  const hasRunningBrowserTasks =
    Number(activeBrowserTasks?.count || 0) > 0 || Number(activeCompoundTasks?.count || 0) > 0;

  const navItems = useMemo(
    () => [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, count: undefined as number | undefined, hasAlert: false },
      { to: '/companies', label: 'Companies', icon: Building2, count: stats?.total_companies, hasAlert: false },
      { to: '/contacts', label: 'Contacts', icon: Users, count: stats?.total_contacts, hasAlert: false },
      { to: '/documents', label: 'Documents', icon: FolderOpen, count: undefined as number | undefined, hasAlert: false },
      { to: '/email', label: 'Email', icon: Mail, count: undefined as number | undefined, hasAlert: false },
      { to: '/templates', label: 'Templates', icon: FileCode2, count: undefined as number | undefined, hasAlert: false },
      { to: '/browser', label: 'Browser', icon: Monitor, count: undefined as number | undefined, hasAlert: false },
      { to: '/tasks', label: 'Tasks', icon: Clock3, count: undefined as number | undefined, hasAlert: hasRunningBrowserTasks },
      { to: '/admin/tests', label: 'Admin', icon: Shield, count: undefined as number | undefined, hasAlert: false },
    ],
    [hasRunningBrowserTasks, stats?.total_companies, stats?.total_contacts]
  );

  const activeNavItem = useMemo(
    () =>
      navItems.find((item) => {
        if (item.to === '/admin/tests') return location.pathname.startsWith('/admin');
        return location.pathname === item.to;
      }) || null,
    [location.pathname, navItems]
  );

  const handleQuickAdd = (type: AppShellQuickAddTarget) => {
    setShowQuickAdd(false);
    if (type === 'contact') navigate('/contacts');
    if (type === 'company') navigate('/companies');
    if (type === 'campaign') navigate('/email');
    workspace.ensureVisibleForRoute(type === 'campaign' ? '/email' : type === 'company' ? '/companies' : '/contacts', { source: 'sidebar' });
    setChatCollapseSignal((prev) => prev + 1);
    setOpenAddModalTarget(type);
  };

  const clearAddModalTarget = () => setOpenAddModalTarget(null);
  const showingChatInteraction = workspace.source === 'chat' && Boolean(workspace.interaction);
  const workspaceTitle = showingChatInteraction ? 'Live UI Preview' : activeNavItem?.label || 'Workspace';
  const workspaceSubtitle = showingChatInteraction
    ? 'Contextual components surfaced by the assistant'
    : 'Manual workspace';

  const openRouteWorkspace = (route: string) => {
    const [routePath] = route.split('?');
    workspace.clearInteraction();
    workspace.ensureVisibleForRoute(routePath || route, { source: 'sidebar', preferredMode: isMobile ? 'fullscreen' : 'drawer' });
    navigate(route);
  };

  return (
    <div className="h-screen flex overflow-hidden bg-bg">
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {!isMobile ? (
        <aside
          className={`h-full shrink-0 border-r border-border bg-surface transition-all duration-200 ${
            sidebarCollapsed ? 'w-16' : 'w-[230px] max-w-[230px]'
          }`}
        >
          <div className="h-14 border-b border-border px-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              {!sidebarCollapsed ? (
                <div className="min-w-0">
                  <h1 className="font-semibold text-text text-sm leading-none truncate">Hello</h1>
                  <p className="text-[10px] text-text-dim leading-none mt-0.5 truncate">Lead Engine</p>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="w-8 h-8 rounded-md border border-border flex items-center justify-center text-text-muted hover:bg-surface-hover"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>

          <div className="h-[calc(100%-3.5rem)] flex flex-col">
            <nav className="px-2 py-2.5 space-y-1 overflow-y-auto flex-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => {
                      workspace.ensureVisibleForRoute(item.to, { source: 'sidebar', preferredMode: 'drawer' });
                      setChatCollapseSignal((prev) => prev + 1);
                    }}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      `flex items-center rounded-md ${
                        sidebarCollapsed ? 'justify-center px-2 py-2' : 'justify-between px-2.5 py-2'
                      } text-sm font-medium ${
                        isActive ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover'
                      }`
                    }
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Icon className="w-4 h-4 shrink-0" />
                      {!sidebarCollapsed ? <span className="truncate">{item.label}</span> : null}
                      {sidebarCollapsed && item.hasAlert ? <Dot className="w-4 h-4 text-red-500 animate-pulse -ml-2" /> : null}
                    </span>
                    {!sidebarCollapsed ? (
                      <span className="flex items-center gap-1 shrink-0">
                        {item.hasAlert ? <Dot className="w-4 h-4 text-red-500 animate-pulse -ml-1" /> : null}
                        {item.count !== undefined ? (
                          <span className="text-[10px] tabular-nums text-text-dim">{item.count.toLocaleString()}</span>
                        ) : null}
                      </span>
                    ) : null}
                  </NavLink>
                );
              })}
            </nav>

            <div className="px-2 py-2 border-t border-border">
              <div className={`relative ${sidebarCollapsed ? 'flex justify-center' : ''}`} ref={quickAddRef}>
                <button
                  type="button"
                  onClick={() => setShowQuickAdd((v) => !v)}
                  title="Quick add"
                  className={`rounded-md bg-accent/10 text-accent flex items-center justify-center ${
                    sidebarCollapsed ? 'w-9 h-9' : 'w-full h-9 gap-2 text-sm font-medium'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  {!sidebarCollapsed ? <span>Quick Add</span> : null}
                </button>
                {showQuickAdd ? (
                  <div
                    className={`absolute top-full mt-1.5 w-44 bg-surface border border-border rounded-lg shadow-lg py-1 z-50 ${
                      sidebarCollapsed ? 'left-full ml-2' : 'left-0'
                    }`}
                  >
                    <button onClick={() => handleQuickAdd('contact')} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover">Add Contact</button>
                    <button onClick={() => handleQuickAdd('company')} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover">Add Company</button>
                    <button onClick={() => handleQuickAdd('campaign')} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover">New Campaign</button>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setShowSettings(true)}
                title="Settings"
                className={`mt-2 rounded-md border border-border text-text-muted flex items-center justify-center ${
                  sidebarCollapsed ? 'w-9 h-9 mx-auto' : 'w-full h-9 gap-2 text-sm font-medium'
                }`}
              >
                <Shield className="w-4 h-4" />
                {!sidebarCollapsed ? <span>Settings</span> : null}
              </button>
            </div>
          </div>
        </aside>
      ) : null}

      <div className="h-full min-w-0 flex-1 flex flex-col overflow-hidden">
        {isMobile ? (
          <header className="h-14 shrink-0 border-b border-border bg-surface px-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen((v) => !v)}
                className="w-8 h-8 rounded-md border border-border flex items-center justify-center"
              >
                <Menu className="w-4 h-4 text-text-muted" />
              </button>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <h1 className="font-semibold text-text text-sm leading-none">Hello</h1>
                  <p className="text-[10px] text-text-dim leading-none mt-0.5">Lead Engine</p>
                </div>
              </div>
            </div>
          </header>
        ) : null}

        {isMobile && mobileNavOpen ? (
          <div className="shrink-0 border-b border-border bg-surface px-3 py-2 flex items-center gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => {
                  workspace.ensureVisibleForRoute(item.to, { source: 'sidebar', preferredMode: 'fullscreen' });
                  setChatCollapseSignal((prev) => prev + 1);
                  setMobileNavOpen(false);
                }}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                    isActive ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover'
                  }`
                }
              >
                {item.label}
                {item.hasAlert ? <Dot className="w-4 h-4 text-red-500 animate-pulse -ml-1" /> : null}
              </NavLink>
            ))}
          </div>
        ) : null}

        <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-2 md:p-3">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-surface">
            {showingChatInteraction ? (
              <WorkspaceSurface
                open={workspace.open}
                mode={workspace.mode}
                mobile={isMobile}
                title={workspaceTitle}
                subtitle={workspaceSubtitle}
                closedLabel="Open Preview"
                onOpen={() => workspace.openWorkspace({ source: 'system' })}
                onClose={workspace.closeWorkspace}
                onModeChange={(nextMode) => workspace.setWorkspaceMode(nextMode)}
              >
                {workspace.interaction ? (
                  <ContextualInteractionPanel
                    interaction={workspace.interaction}
                    onOpenRoute={openRouteWorkspace}
                    onDismiss={workspace.clearInteraction}
                  />
                ) : null}
              </WorkspaceSurface>
            ) : (
              <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
                <Outlet context={{ openAddModalTarget, clearAddModalTarget } satisfies AppShellOutletContext} />
              </main>
            )}

            {!hideDockOnContacts ? (
              <div className={`min-h-0 overflow-hidden p-2 md:p-3 ${chatExpanded ? 'flex-1' : 'shrink-0 mt-auto'}`}>
                <ChatDock
                  onHeightChange={() => {}}
                  fullHeight
                  embedded
                  collapseSignal={chatCollapseSignal}
                  onExpandedChange={setChatExpanded}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
