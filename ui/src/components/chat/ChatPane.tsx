import { useState } from 'react';
import { ChatContainer } from './ChatContainer';
import { BrowserViewer } from './BrowserViewer';
import { RunTracePanel } from './RunTracePanel';
import { useChatProvider } from '../../contexts/chatContext';

export function ChatPane() {
  const [traceOpen, setTraceOpen] = useState(false);
  const {
    messages,
    isTyping,
    sendMessage,
    handleAction,
    browserViewerOpen,
    closeBrowserViewer,
    salesforceSaveUrl,
    salesforceSearch,
    salesforceSkip,
  } = useChatProvider();

  return (
    <div className="h-full min-h-0 flex flex-col p-3 md:p-4 border-r border-border bg-surface">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Assistant</h2>
        <button
          type="button"
          onClick={() => setTraceOpen((prev) => !prev)}
          className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover"
        >
          {traceOpen ? 'Hide Trace' : 'Show Trace'}
        </button>
      </div>
      <RunTracePanel expanded={traceOpen} />
      {browserViewerOpen ? (
        <div className="mb-2">
          <BrowserViewer isOpen={browserViewerOpen} onClose={closeBrowserViewer} />
        </div>
      ) : null}
      <div className="flex-1 min-h-0">
        <ChatContainer
          messages={messages}
          isTyping={isTyping}
          onSendMessage={sendMessage}
          onAction={handleAction}
          onSalesforceSaveUrl={salesforceSaveUrl}
          onSalesforceSearch={salesforceSearch}
          onSalesforceSkip={salesforceSkip}
        />
      </div>
    </div>
  );
}
