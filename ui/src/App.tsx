import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  Settings,
  Zap,
  Minus,
  Maximize2,
  X,
  Mail
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
  const [page, setPage] = useState<Page>('dashboard');
  const pywebview = (window as any).pywebview;

  const navItems = [
    { id: 'dashboard' as Page, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'companies' as Page, label: 'Companies', icon: Building2 },
    { id: 'contacts' as Page, label: 'Contacts', icon: Users },
    { id: 'email' as Page, label: 'Email', icon: Mail },
  ];

  return (
    <div className="h-screen flex overflow-hidden">
      <NotificationContainer />
      {/* Window controls - top right corner */}
      <div className="fixed top-0 right-0 z-50 flex">
        <button 
          onClick={() => pywebview?.api?.minimize?.()}
          className="w-10 h-8 flex items-center justify-center hover:bg-white/10"
        >
          <Minus className="w-3 h-3 text-text-dim" />
        </button>
        <button 
          onClick={() => pywebview?.api?.maximize?.()}
          className="w-10 h-8 flex items-center justify-center hover:bg-white/10"
        >
          <Maximize2 className="w-3 h-3 text-text-dim" />
        </button>
        <button 
          onClick={() => pywebview?.api?.close?.() || window.close()}
          className="w-10 h-8 flex items-center justify-center hover:bg-red-500 group"
        >
          <X className="w-3 h-3 text-text-dim group-hover:text-white" />
        </button>
      </div>

      {/* Sidebar - Fixed */}
      <aside className="w-64 bg-surface border-r border-border flex flex-col shrink-0">
        {/* Logo */}
        <div className="h-14 flex items-center gap-3 px-5 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-text text-sm">Hello</h1>
            <p className="text-xs text-text-dim">Lead Engine</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:text-text hover:bg-surface-hover'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
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

      {/* Main Content - Scrollable */}
      <main className="flex-1 bg-bg overflow-y-auto">
        {page === 'dashboard' && <Dashboard />}
        {page === 'companies' && <Companies />}
        {page === 'contacts' && <Contacts />}
        {page === 'email' && <Email />}
      </main>
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
