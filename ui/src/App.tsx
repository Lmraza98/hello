'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { NotificationProvider } from './contexts/NotificationContext';
import { NotificationContainer } from './components/NotificationContainer';
import { WorkspaceLayoutProvider, useWorkspaceLayout } from './components/shell/workspaceLayout';
import { PageContextProvider } from './contexts/PageContextProvider';
import { ChatProvider } from './contexts/ChatProvider';
import { AssistantGuideProvider, useAssistantGuide } from './contexts/AssistantGuideContext';
import { useActionExecutor } from './chat/actionExecutor';
import { bootstrapCapabilities } from './capabilities/bootstrap';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

function RuntimeProviders({ children }: { children: ReactNode }) {
  const workspace = useWorkspaceLayout();
  const guidance = useAssistantGuide();
  const { executeActions } = useActionExecutor({ workspace, guidance });
  const chatRuntimeEnabled = String(process.env.NEXT_PUBLIC_CHAT_RUNTIME_ENABLED ?? '1') === '1';

  useEffect(() => {
    bootstrapCapabilities();
  }, []);

  if (!chatRuntimeEnabled) {
    return (
      <>
        <NotificationContainer />
        {children}
      </>
    );
  }

  return (
    <ChatProvider onActions={executeActions}>
      <NotificationContainer />
      {children}
    </ChatProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <PageContextProvider>
          <WorkspaceLayoutProvider>
            <AssistantGuideProvider>
              <RuntimeProviders>{children}</RuntimeProviders>
            </AssistantGuideProvider>
          </WorkspaceLayoutProvider>
        </PageContextProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
}

