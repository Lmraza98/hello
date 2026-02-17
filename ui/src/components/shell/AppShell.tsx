import { useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import {
  Building2,
  Database,
  Dot,
  LayoutDashboard,
  Mail,
  Menu,
  Monitor,
  Plus,
  Shield,
  Users,
  Zap,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ChatPane } from '../chat/ChatPane';
import { SettingsModal } from '../settings/SettingsModal';

export type AppShellQuickAddTarget = 'contact' | 'company' | 'campaign' | null;

export interface AppShellOutletContext {
  openAddModalTarget: AppShellQuickAddTarget;
  clearAddModalTarget: () => void;
}

export function useAppShellContext() {
  return useOutletContext<AppShellOutletContext>();
}

export function AppShell() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openAddModalTarget, setOpenAddModalTarget] = useState<AppShellQuickAddTarget>(null);
  const quickAddRef = useRef<HTMLDivElement>(null);

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
      { to: '/email', label: 'Email', icon: Mail, count: undefined as number | undefined, hasAlert: false },
      { to: '/bi', label: 'BI', icon: Database, count: undefined as number | undefined, hasAlert: false },
      { to: '/tasks', label: 'Tasks', icon: Monitor, count: undefined as number | undefined, hasAlert: hasRunningBrowserTasks },
      { to: '/admin/logs', label: 'Admin', icon: Shield, count: undefined as number | undefined, hasAlert: false },
    ],
    [hasRunningBrowserTasks, stats?.total_companies, stats?.total_contacts]
  );

  const handleQuickAdd = (type: AppShellQuickAddTarget) => {
    setShowQuickAdd(false);
    if (type === 'contact') navigate('/contacts');
    if (type === 'company') navigate('/companies');
    if (type === 'campaign') navigate('/email');
    setOpenAddModalTarget(type);
  };

  const clearAddModalTarget = () => setOpenAddModalTarget(null);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bg">
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

      <header className="h-14 shrink-0 border-b border-border bg-surface px-3 md:px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              className="w-8 h-8 rounded-md border border-border flex items-center justify-center"
            >
              <Menu className="w-4 h-4 text-text-muted" />
            </button>
          ) : null}
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

        <nav className={`${isMobile ? 'hidden' : 'flex'} items-center gap-1`}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    isActive ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
                {item.hasAlert ? (
                  <Dot className="w-4 h-4 text-red-500 animate-pulse -ml-1" />
                ) : null}
                {item.count !== undefined ? (
                  <span className="text-[10px] tabular-nums text-text-dim">{item.count.toLocaleString()}</span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="relative flex items-center gap-2" ref={quickAddRef}>
          <button
            type="button"
            onClick={() => setShowQuickAdd((v) => !v)}
            className="w-8 h-8 rounded-md bg-accent/10 text-accent flex items-center justify-center"
          >
            <Plus className="w-4 h-4" />
          </button>
          {showQuickAdd ? (
            <div className="absolute right-0 top-full mt-1.5 w-44 bg-surface border border-border rounded-lg shadow-lg py-1 z-50">
              <button onClick={() => handleQuickAdd('contact')} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover">Add Contact</button>
              <button onClick={() => handleQuickAdd('company')} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover">Add Company</button>
              <button onClick={() => handleQuickAdd('campaign')} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover">New Campaign</button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="w-8 h-8 rounded-md border border-border flex items-center justify-center text-text-muted"
          >
            <Shield className="w-4 h-4" />
          </button>
        </div>
      </header>

      {isMobile && mobileNavOpen ? (
        <div className="shrink-0 border-b border-border bg-surface px-3 py-2 flex items-center gap-1 overflow-x-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileNavOpen(false)}
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

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[38%_62%]">
        <ChatPane />
        <main className="min-h-0 overflow-y-auto">
          <Outlet context={{ openAddModalTarget, clearAddModalTarget } satisfies AppShellOutletContext} />
        </main>
      </div>
    </div>
  );
}
