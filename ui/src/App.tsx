import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import Contacts from './pages/Contacts';
import Email from './pages/Email';
import Bi from './pages/Bi';
import BrowserPage from './pages/Browser';
import Admin from './pages/admin/Admin';
import AdminLogs from './pages/admin/AdminLogs';
import AdminCosts from './pages/admin/AdminCosts';
import AdminFinetune from './pages/admin/AdminFinetune';
import AdminTests from './pages/admin/AdminTests';
import { NotificationProvider } from './contexts/NotificationContext';
import { NotificationContainer } from './components/NotificationContainer';
import { AppShell, useAppShellContext } from './components/shell/AppShell';
import { PageContextProvider } from './contexts/PageContextProvider';
import { ChatProvider } from './contexts/ChatProvider';
import { useActionExecutor } from './chat/actionExecutor';
import { bootstrapCapabilities } from './capabilities/bootstrap';
import { useEffect } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

function CompaniesRoute() {
  const { openAddModalTarget, clearAddModalTarget } = useAppShellContext();
  return (
    <Companies
      openAddModal={openAddModalTarget === 'company'}
      onModalOpened={clearAddModalTarget}
    />
  );
}

function ContactsRoute() {
  const { openAddModalTarget, clearAddModalTarget } = useAppShellContext();
  return (
    <Contacts
      openAddModal={openAddModalTarget === 'contact'}
      onModalOpened={clearAddModalTarget}
    />
  );
}

function EmailRoute() {
  const { openAddModalTarget, clearAddModalTarget } = useAppShellContext();
  return (
    <Email
      openAddModal={openAddModalTarget === 'campaign'}
      onModalOpened={clearAddModalTarget}
    />
  );
}

function AdminRoute({ tab }: { tab: 'logs' | 'costs' | 'finetune' | 'tests' }) {
  const navigate = useNavigate();
  return (
    <Admin
      tab={tab}
      onTabChange={(next) => navigate(`/admin/${next}`)}
      logsContent={<AdminLogs />}
      costsContent={<AdminCosts />}
      finetuneContent={<AdminFinetune />}
      testsContent={<AdminTests />}
    />
  );
}

function RoutedApp() {
  const { executeActions } = useActionExecutor();
  useEffect(() => {
    bootstrapCapabilities();
  }, []);
  return (
    <PageContextProvider>
      <ChatProvider onActions={executeActions}>
        <NotificationContainer />
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="companies" element={<CompaniesRoute />} />
            <Route path="contacts" element={<ContactsRoute />} />
            <Route path="email" element={<EmailRoute />} />
            <Route path="bi" element={<Bi />} />
            <Route path="tasks" element={<BrowserPage />} />
            <Route
              path="admin/logs"
              element={<AdminRoute tab="logs" />}
            />
            <Route
              path="admin/costs"
              element={<AdminRoute tab="costs" />}
            />
            <Route
              path="admin/finetune"
              element={<AdminRoute tab="finetune" />}
            />
            <Route
              path="admin/tests"
              element={<AdminRoute tab="tests" />}
            />
          </Route>
        </Routes>
      </ChatProvider>
    </PageContextProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <RoutedApp />
      </NotificationProvider>
    </QueryClientProvider>
  );
}
