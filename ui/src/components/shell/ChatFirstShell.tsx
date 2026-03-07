import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Clock3,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { GlobalAssistantPanel } from '../assistant/GlobalAssistantPanel';
import { ContextPreviewDrawer } from '../assistant/ContextPreviewDrawer';
import { isContextPreviewAllowed } from '../assistant/contextPreviewRules';
import { SettingsModal } from '../settings/SettingsModal';
import { AppShellContext, type AppShellQuickAddTarget } from './appShellContext';
import { useWorkspaceLayout } from './workspaceLayout';
import { useAssistantGuide } from '../../contexts/AssistantGuideContext';

const ASSISTANT_DOCK_HEIGHT_KEY = 'hello_assistant_dock_height_v1';
const ASSISTANT_DOCK_COLLAPSED_HEIGHT = 46;
const ASSISTANT_DOCK_DEFAULT_HEIGHT = 340;

function clampDockHeight(height: number): number {
  return Math.max(ASSISTANT_DOCK_COLLAPSED_HEIGHT, Math.round(height));
}

export function ChatFirstShell({ children }: { children: ReactNode }) {
  const assistantPanelEnabled = String(process.env.NEXT_PUBLIC_ASSISTANT_PANEL_ENABLED ?? '1') !== '0';
  const shellPollingEnabled = String(process.env.NEXT_PUBLIC_SHELL_POLLING_ENABLED ?? '1') !== '0';
  const isMobile = useIsMobile();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const workspace = useWorkspaceLayout();
  const { guideState } = useAssistantGuide();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openAddModalTarget, setOpenAddModalTarget] = useState<AppShellQuickAddTarget>(null);
  const [chatCollapseSignal, setChatCollapseSignal] = useState(0);
  const [assistantDockHeight, setAssistantDockHeight] = useState(ASSISTANT_DOCK_DEFAULT_HEIGHT);
  const [assistantDockResizing, setAssistantDockResizing] = useState(false);
  const workspaceStackRef = useRef<HTMLDivElement | null>(null);
  const quickAddRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: shellPollingEnabled ? 5000 : false,
  });
  const { data: activeBrowserTasks } = useQuery({
    queryKey: ['browser', 'activeTaskCount', 'nav'],
    queryFn: () => api.getBrowserWorkflowTasks({ includeFinished: false, limit: 1 }),
    refetchInterval: shellPollingEnabled ? 2000 : false,
  });
  const { data: activeCompoundTasks } = useQuery({
    queryKey: ['compound', 'activeTaskCount', 'nav'],
    queryFn: () => api.getCompoundWorkflows({ status: 'running', limit: 1 }),
    refetchInterval: shellPollingEnabled ? 2000 : false,
  });
  const { data: inboundLeadAlerts } = useQuery({
    queryKey: ['emails', 'inboundLeadAlerts'],
    queryFn: api.getInboundLeadAlerts,
    refetchInterval: shellPollingEnabled ? 5000 : false,
  });
  const hasRunningBrowserTasks =
    Number(activeBrowserTasks?.count || 0) > 0 || Number(activeCompoundTasks?.count || 0) > 0;
  const unseenInboundLeadCount = Number(inboundLeadAlerts?.unseen_count || 0);
  const hasInboundLeadAlert = unseenInboundLeadCount > 0;
  const { mutate: markInboundLeadsSeen, isPending: isMarkInboundLeadsSeenPending } = useMutation({
    mutationFn: api.markInboundLeadsSeen,
    onSuccess: () => {
      queryClient.setQueryData(['emails', 'inboundLeadAlerts'], { unseen_count: 0 });
    },
  });

  useEffect(() => {
    if (!pathname.startsWith('/contacts')) return;
    if (!hasInboundLeadAlert) return;
    if (isMarkInboundLeadsSeenPending) return;
    markInboundLeadsSeen();
  }, [hasInboundLeadAlert, isMarkInboundLeadsSeenPending, pathname, markInboundLeadsSeen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedHeight = Number.parseInt(window.localStorage.getItem(ASSISTANT_DOCK_HEIGHT_KEY) || '', 10);
    if (Number.isFinite(storedHeight)) {
      setAssistantDockHeight(clampDockHeight(storedHeight));
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ASSISTANT_DOCK_HEIGHT_KEY, String(clampDockHeight(assistantDockHeight)));
  }, [assistantDockHeight]);

  useEffect(() => {
    if (!guideState.active) return;
    const availableHeight = workspaceStackRef.current?.clientHeight || window.innerHeight;
    setAssistantDockHeight((prev) => Math.max(prev, Math.max(availableHeight - 12, 420)));
  }, [guideState.active]);

  const navItems = useMemo(
    () => [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, count: undefined as number | undefined, hasAlert: false },
      { to: '/contacts', label: 'Contacts', icon: Users, count: stats?.total_contacts, hasAlert: hasInboundLeadAlert },
      { to: '/documents', label: 'Documents', icon: FolderOpen, count: undefined as number | undefined, hasAlert: false },
      { to: '/email', label: 'Email', icon: Mail, count: undefined as number | undefined, hasAlert: false },
      { to: '/browser', label: 'Browser', icon: Monitor, count: undefined as number | undefined, hasAlert: false },
      { to: '/tasks', label: 'Tasks', icon: Clock3, count: undefined as number | undefined, hasAlert: hasRunningBrowserTasks },
      { to: '/admin/tests', label: 'Admin', icon: Shield, count: undefined as number | undefined, hasAlert: false },
    ],
    [hasInboundLeadAlert, hasRunningBrowserTasks, stats?.total_contacts]
  );

  const activeNavItem = useMemo(
    () =>
      navItems.find((item) => {
        if (item.to === '/admin/tests') return pathname.startsWith('/admin');
        if (item.to === '/email') return pathname.startsWith('/email') || pathname.startsWith('/templates');
        return pathname === item.to;
      }) || null,
    [pathname, navItems]
  );

  const handleQuickAdd = (type: AppShellQuickAddTarget) => {
    setShowQuickAdd(false);
    if (type === 'contact' || type === 'company') router.push('/contacts');
    if (type === 'campaign') router.push('/email');
    workspace.ensureVisibleForRoute(type === 'campaign' ? '/email' : '/contacts', { source: 'sidebar' });
    setChatCollapseSignal((prev) => prev + 1);
    setOpenAddModalTarget(type === 'company' ? 'contact' : type);
  };

  const clearAddModalTarget = () => setOpenAddModalTarget(null);
  const showingChatInteraction = workspace.source === 'chat' && isContextPreviewAllowed(workspace.interaction);
  const workspaceTitle = showingChatInteraction ? 'Context Preview' : activeNavItem?.label || 'Workspace';
  const workspaceSubtitle = showingChatInteraction
    ? 'Contextual components surfaced by the assistant'
    : 'Manual workspace';

  const openRouteWorkspace = (route: string) => {
    const [routePath] = route.split('?');
    workspace.clearInteraction();
    workspace.ensureVisibleForRoute(routePath || route, { source: 'sidebar', preferredMode: isMobile ? 'fullscreen' : 'drawer' });
    router.push(route);
  };

  const startAssistantDockResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (isMobile) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = assistantDockHeight;
    setAssistantDockResizing(true);
    const nextMin = ASSISTANT_DOCK_COLLAPSED_HEIGHT;
    const availableHeight = workspaceStackRef.current?.clientHeight || window.innerHeight;
    const nextMax = Math.max(nextMin, availableHeight);
    const onMove = (moveEvent: PointerEvent) => {
      const delta = startY - moveEvent.clientY;
      const nextHeight = Math.max(nextMin, Math.min(nextMax, Math.round(startHeight + delta)));
      setAssistantDockHeight(nextHeight);
    };
    const onUp = () => {
      setAssistantDockResizing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
                  <Link
                    key={item.to}
                    href={item.to}
                    onClick={() => {
                      workspace.ensureVisibleForRoute(item.to, { source: 'sidebar', preferredMode: 'drawer' });
                      setChatCollapseSignal((prev) => prev + 1);
                    }}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`flex items-center rounded-md ${
                      sidebarCollapsed ? 'justify-center px-2 py-2' : 'justify-between px-2.5 py-2'
                    } text-sm font-medium ${
                      (
                        item.to === '/admin/tests'
                          ? pathname.startsWith('/admin')
                          : item.to === '/email'
                          ? pathname.startsWith('/email') || pathname.startsWith('/templates')
                          : pathname === item.to
                      )
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-muted hover:bg-surface-hover'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Icon className="w-4 h-4 shrink-0" />
                      {!sidebarCollapsed ? <span className="truncate">{item.label}</span> : null}
                      {sidebarCollapsed && item.hasAlert ? (
                        <span className="relative -ml-1 inline-flex h-3.5 w-3.5 items-center justify-center">
                          <span className="absolute inline-flex h-3.5 w-3.5 rounded-full bg-red-500/70 animate-ping" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                        </span>
                      ) : null}
                    </span>
                    {!sidebarCollapsed ? (
                      <span className="flex items-center gap-1 shrink-0">
                        {item.hasAlert ? (
                          <span className="relative inline-flex h-4 w-4 items-center justify-center">
                            <span className="absolute inline-flex h-4 w-4 rounded-full bg-red-500/70 animate-ping" />
                            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                          </span>
                        ) : null}
                        {!item.hasAlert && item.count !== undefined ? (
                          <span className="text-[10px] tabular-nums text-text-dim">{item.count.toLocaleString()}</span>
                        ) : null}
                      </span>
                    ) : null}
                  </Link>
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
              <Link
                key={item.to}
                href={item.to}
                onClick={() => {
                  workspace.ensureVisibleForRoute(item.to, { source: 'sidebar', preferredMode: 'fullscreen' });
                  setChatCollapseSignal((prev) => prev + 1);
                  setMobileNavOpen(false);
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                  (item.to === '/admin/tests' ? pathname.startsWith('/admin') : pathname === item.to)
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:bg-surface-hover'
                }`}
              >
                {item.label}
                {item.hasAlert ? (
                  <span className="relative inline-flex h-4 w-4 items-center justify-center -ml-0.5">
                    <span className="absolute inline-flex h-4 w-4 rounded-full bg-red-500/70 animate-ping" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : null}

        <div
          ref={workspaceStackRef}
          className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${assistantDockResizing ? 'cursor-row-resize select-none' : ''}`}
        >
          <div className="min-h-0 flex-1 overflow-hidden">
            {showingChatInteraction ? (
              <ContextPreviewDrawer
                open={workspace.open}
                mode={workspace.mode}
                mobile={isMobile}
                interaction={workspace.interaction}
                title={workspaceTitle}
                subtitle={workspaceSubtitle}
                onOpen={() => workspace.openWorkspace({ source: 'system' })}
                onClose={workspace.closeWorkspace}
                onModeChange={(nextMode) => workspace.setWorkspaceMode(nextMode)}
                onOpenRoute={openRouteWorkspace}
                onDismiss={workspace.clearInteraction}
              />
            ) : (
              <AppShellContext.Provider value={{ openAddModalTarget, clearAddModalTarget }}>
                <main className="h-full min-h-0 overflow-y-auto px-3 pb-3 md:px-4 md:pb-4">{children}</main>
              </AppShellContext.Provider>
            )}
          </div>

          {assistantPanelEnabled ? (
            <section
              className={
                guideState.active
                  ? 'pointer-events-none absolute inset-x-0 bottom-0 z-50 px-2 pb-2 md:px-3 md:pb-3'
                  : 'relative shrink-0'
              }
            >
              {!guideState.active ? (
                <button
                  type="button"
                  onPointerDown={startAssistantDockResize}
                  className="absolute inset-x-0 -top-2 z-20 flex h-2 items-end justify-center cursor-row-resize"
                  aria-label="Resize assistant dock"
                  title="Drag to resize assistant"
                >
                  <span className="pointer-events-none h-px w-24 rounded-full bg-border/90" />
                </button>
              ) : null}
              <div className={guideState.active ? 'pointer-events-none bg-transparent' : 'bg-transparent'}>
                <div
                  style={{ height: `${assistantDockHeight}px` }}
                  className={`${guideState.active ? 'pointer-events-none ' : ''}min-h-0 transition-[height] duration-[1100ms] ease-[cubic-bezier(0.16,1,0.3,1)]`}
                >
                  <GlobalAssistantPanel
                    dock={{
                      onHeightChange: () => {},
                      fullHeight: true,
                      forceExpanded: true,
                      embedded: true,
                      collapseSignal: chatCollapseSignal,
                      onRequestMinimize: () => setAssistantDockHeight(ASSISTANT_DOCK_COLLAPSED_HEIGHT),
                    }}
                  />
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}







