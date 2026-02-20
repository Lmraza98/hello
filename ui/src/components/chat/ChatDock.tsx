import { Pin, PinOff, ChevronUp, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useChatProvider } from '../../contexts/chatContext';
import { ChatContainer } from './ChatContainer';
import { ChatInput } from './ChatInput';
import { BrowserViewer } from './BrowserViewer';
import { TraceDrawer } from './TraceDrawer';

const STORAGE_EXPANDED_KEY = 'hello_chat_dock_expanded_v1';
const STORAGE_PINNED_KEY = 'hello_chat_dock_pinned_v1';

function parseStoredBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  return fallback;
}

type ChatDockProps = {
  onHeightChange: (heightPx: number) => void;
  fullHeight?: boolean;
  forceExpanded?: boolean;
  embedded?: boolean;
  collapseSignal?: number;
  onExpandedChange?: (expanded: boolean) => void;
};

export function ChatDock({
  onHeightChange,
  fullHeight = false,
  forceExpanded = false,
  embedded = false,
  collapseSignal,
  onExpandedChange,
}: ChatDockProps) {
  const [expanded, setExpanded] = useState(() => parseStoredBool(STORAGE_EXPANDED_KEY, false));
  const [pinned, setPinned] = useState(() => parseStoredBool(STORAGE_PINNED_KEY, false));
  const [traceOpen, setTraceOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const collapseSignalRef = useRef<number | null>(null);
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
  const isExpanded = forceExpanded || expanded;

  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);

  useEffect(() => {
    if (collapseSignal == null) return;
    if (collapseSignalRef.current === null) {
      collapseSignalRef.current = collapseSignal;
      return;
    }
    if (collapseSignalRef.current === collapseSignal) return;
    collapseSignalRef.current = collapseSignal;
    setPinned(false);
    setTraceOpen(false);
    setExpanded(false);
  }, [collapseSignal]);

  useEffect(() => {
    if (forceExpanded) return;
    localStorage.setItem(STORAGE_EXPANDED_KEY, expanded ? '1' : '0');
  }, [expanded, forceExpanded]);

  useEffect(() => {
    localStorage.setItem(STORAGE_PINNED_KEY, pinned ? '1' : '0');
  }, [pinned]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return;
    if (lastMessage.id === lastMessageIdRef.current) return;
    lastMessageIdRef.current = lastMessage.id;
    setExpanded(true);
  }, [messages]);

  useEffect(() => {
    if (isTyping) setExpanded(true);
  }, [isTyping]);

  useEffect(() => {
    if (!hostRef.current) return;
    const node = hostRef.current;
    const update = () => {
      onHeightChange(Math.ceil(node.getBoundingClientRect().height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [embedded, expanded, onHeightChange, pinned, forceExpanded]);

  const input = (
    <ChatInput
      onSend={(text) => {
        setExpanded(true);
        void sendMessage(text);
      }}
      onFocus={() => setExpanded(true)}
      onUploadFiles={(files) => {
        setExpanded(true);
        void uploadFiles(files);
      }}
      disabled={isTyping}
      isStreaming={isTyping}
      onStop={stopAssistantResponse}
    />
  );

  if (embedded && !isExpanded) {
    return (
      <>
        <section
          ref={hostRef}
          className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
        >
          {input}
        </section>
        <TraceDrawer open={traceOpen} onClose={() => setTraceOpen(false)} />
      </>
    );
  }

  return (
    <>
      <section
        ref={hostRef}
        className={
          embedded
            ? 'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm'
            : fullHeight
              ? 'absolute inset-2 z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl md:inset-3'
              : `absolute bottom-2 left-1/2 z-20 flex flex-col w-[min(1180px,calc(100%-1rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl md:bottom-3 md:w-[min(1260px,calc(100%-1.5rem))] ${
                isExpanded ? 'h-[52vh] min-h-[320px] max-h-[680px]' : 'h-[120px]'
                }`
        }
      >
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">Assistant</p>
            <p className="truncate text-[11px] text-text-muted">Chat-first control plane</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTraceOpen((prev) => !prev)}
              className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover"
            >
              {traceOpen ? 'Hide Trace' : 'Show Trace'}
            </button>
            <button
              type="button"
              onClick={() => setPinned((prev) => !prev)}
              className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
              title={pinned ? 'Unpin transcript' : 'Pin transcript open'}
            >
              {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setExpanded((prev) => (pinned || forceExpanded ? true : !prev))}
              className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
              title={isExpanded ? 'Collapse chat dock' : 'Expand chat dock'}
              disabled={forceExpanded}
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>
          </div>
        </header>

        <div className="min-h-0 flex flex-1 flex-col">
          <div className="min-h-0 flex flex-1 flex-col">
            {browserViewerOpen ? (
              <div className="px-3 pb-1 pt-2">
                <BrowserViewer isOpen={browserViewerOpen} onClose={closeBrowserViewer} />
              </div>
            ) : null}
            <div className="min-h-0 flex-1 px-1 pb-1">
              <div className="h-full overflow-hidden">
                <ChatContainer
                  messages={messages}
                  thoughtState={thoughtState}
                  isTyping={isTyping}
                  typingText={assistantStreamingText}
                  streamTopOffsetPx={22}
                  onSendMessage={(text) => {
                    setExpanded(true);
                    void sendMessage(text);
                  }}
                  onUploadFiles={uploadFiles}
                  onStopStreaming={stopAssistantResponse}
                  onAction={(value) => {
                    setExpanded(true);
                    void handleAction(value);
                  }}
                  onSalesforceSaveUrl={salesforceSaveUrl}
                  onSalesforceSearch={salesforceSearch}
                  onSalesforceSkip={salesforceSkip}
                  showComposer={false}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border bg-surface">{input}</div>
        </div>
      </section>
      <TraceDrawer open={traceOpen} onClose={() => setTraceOpen(false)} />
    </>
  );
}
