import { useState, useRef, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useIsMobile } from './hooks/useIsMobile';
import {
  LayoutDashboard,
  Building2,
  Users,
  Settings,
  Zap,
  Minus,
  Maximize2,
  X,
  Mail,
  Plus,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import Contacts from './pages/Contacts';
import Email from './pages/Email';
import { NotificationProvider } from './contexts/NotificationContext';
import { NotificationContainer } from './components/NotificationContainer';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

type Page = 'dashboard' | 'companies' | 'contacts' | 'email';

function AppContent() {
  const isMobile = useIsMobile();
  const [page, setPage] = useState<Page>('dashboard');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [addModalTarget, setAddModalTarget] = useState<string | null>(null);
  const quickAddRef = useRef<HTMLDivElement>(null);
  const pywebview = (window as any).pywebview;

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 5000,
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (quickAddRef.current && !quickAddRef.current.contains(e.target as Node)) {
        setShowQuickAdd(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleQuickAdd = (type: string) => {
    setShowQuickAdd(false);
    if (type === 'contact') {
      setPage('contacts');
      setAddModalTarget('contact');
    } else if (type === 'company') {
      setPage('companies');
      setAddModalTarget('company');
    } else if (type === 'campaign') {
      setPage('email');
      setAddModalTarget('campaign');
    }
  };

  const clearAddModal = () => setAddModalTarget(null);

  const navItems = [
    { id: 'dashboard' as Page, label: 'Dashboard', icon: LayoutDashboard, count: undefined as number | undefined },
    { id: 'companies' as Page, label: 'Companies', icon: Building2, count: stats?.total_companies },
    { id: 'contacts' as Page, label: 'Contacts', icon: Users, count: stats?.total_contacts },
    { id: 'email' as Page, label: 'Email', icon: Mail, count: undefined as number | undefined },
  ];

  return (
    <div className="h-screen flex flex-col md:flex-row overflow-hidden">
      <NotificationContainer />

      {/* Window controls — desktop only */}
      {!isMobile && (
        <div className="fixed top-0 right-0 z-50 flex">
          <button
            onClick={() => pywebview?.api?.minimize?.()}
            className="w-10 h-8 flex items-center justify-center hover:bg-black/5 transition-colors"
          >
            <Minus className="w-3 h-3 text-text-dim" />
          </button>
          <button
            onClick={() => pywebview?.api?.maximize?.()}
            className="w-10 h-8 flex items-center justify-center hover:bg-black/5 transition-colors"
          >
            <Maximize2 className="w-3 h-3 text-text-dim" />
          </button>
          <button
            onClick={() => pywebview?.api?.close?.() || window.close()}
            className="w-10 h-8 flex items-center justify-center hover:bg-red-500 group transition-colors"
          >
            <X className="w-3 h-3 text-text-dim group-hover:text-white" />
          </button>
        </div>
      )}

      {/* ── Desktop Sidebar ── */}
      {!isMobile && (
        <aside className="w-56 bg-surface border-r border-border flex flex-col shrink-0">
          {/* Logo + Quick Add */}
          <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h1 className="font-semibold text-text text-sm leading-none">Hello</h1>
                <p className="text-[10px] text-text-dim leading-none mt-0.5">Lead Engine</p>
              </div>
            </div>

            <div className="relative" ref={quickAddRef}>
              <button
                onClick={() => setShowQuickAdd(!showQuickAdd)}
                className="w-7 h-7 rounded-lg bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              {showQuickAdd && (
                <div className="absolute right-0 top-full mt-1.5 w-44 bg-surface border border-border rounded-lg shadow-lg py-1 z-50">
                  <button onClick={() => handleQuickAdd('contact')} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover flex items-center gap-2 transition-colors">
                    <Users className="w-4 h-4 text-text-muted" /> Add Contact
                  </button>
                  <button onClick={() => handleQuickAdd('company')} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover flex items-center gap-2 transition-colors">
                    <Building2 className="w-4 h-4 text-text-muted" /> Add Company
                  </button>
                  <button onClick={() => handleQuickAdd('campaign')} className="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-hover flex items-center gap-2 transition-colors">
                    <Mail className="w-4 h-4 text-text-muted" /> New Campaign
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = page === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-muted hover:text-text hover:bg-surface-hover'
                  }`}
                >
                  <Icon className="w-[18px] h-[18px]" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.count !== undefined && (
                    <span className={`text-xs tabular-nums ${isActive ? 'text-accent/70' : 'text-text-dim'}`}>
                      {item.count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-text-dim">
              <Settings className="w-4 h-4" />
              <span>v1.0.0</span>
            </div>
          </div>
        </aside>
      )}

      {/* Main Content */}
      <main className="flex-1 bg-bg overflow-y-auto pb-16 md:pb-0">
        {page === 'dashboard' && <Dashboard />}
        {page === 'companies' && <Companies openAddModal={addModalTarget === 'company'} onModalOpened={clearAddModal} />}
        {page === 'contacts' && <Contacts openAddModal={addModalTarget === 'contact'} onModalOpened={clearAddModal} />}
        {page === 'email' && <Email openAddModal={addModalTarget === 'campaign'} onModalOpened={clearAddModal} />}
      </main>

      {/* ── Mobile Bottom Tab Bar ── */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border safe-area-bottom">
          <div className="flex items-stretch h-14">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = page === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                    isActive ? 'text-accent' : 'text-text-muted active:text-text'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium leading-none">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <AppContent />
      </NotificationProvider>
    </QueryClientProvider>
  );
}