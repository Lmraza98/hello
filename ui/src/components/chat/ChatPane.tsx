import { useEffect, useRef, useState } from 'react';
import { ChatContainer } from './ChatContainer';
import { BrowserViewer } from './BrowserViewer';
import { ChatTopBar } from './ChatTopBar';
import { TraceDrawer } from './TraceDrawer';
import { useChatProvider } from '../../contexts/chatContext';

export function ChatPane() {
  const [traceOpen, setTraceOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [streamTopOffsetPx, setStreamTopOffsetPx] = useState(28);
  const {
    messages,
    thoughtState,
    isTyping,
    assistantStreamingText,
    sendMessage,
    uploadFiles,
    stopAssistantResponse,
    handleAction,
    browserViewerOpen,
    closeBrowserViewer,
    salesforceSaveUrl,
    salesforceSearch,
    salesforceSkip,
  } = useChatProvider();

  useEffect(() => {
    const compute = () => {
      const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
      setStreamTopOffsetPx(Math.round(headerHeight + 12));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  return (
    <div className="h-full min-h-0 flex flex-col bg-surface">
      <div ref={headerRef}>
        <ChatTopBar traceOpen={traceOpen} onToggleTrace={() => setTraceOpen((prev) => !prev)} />
      </div>
      {browserViewerOpen ? (
        <div className="px-3 pt-2 md:px-4">
          <BrowserViewer isOpen={browserViewerOpen} onClose={closeBrowserViewer} />
        </div>
      ) : null}
      <div className="flex-1 min-h-0">
        <ChatContainer
          messages={messages}
          thoughtState={thoughtState}
          isTyping={isTyping}
          typingText={assistantStreamingText}
          streamTopOffsetPx={streamTopOffsetPx}
          onSendMessage={sendMessage}
          onUploadFiles={uploadFiles}
          onStopStreaming={stopAssistantResponse}
          onAction={handleAction}
          onSalesforceSaveUrl={salesforceSaveUrl}
          onSalesforceSearch={salesforceSearch}
          onSalesforceSkip={salesforceSkip}
        />
      </div>
      <TraceDrawer open={traceOpen} onClose={() => setTraceOpen(false)} />
    </div>
  );
}
