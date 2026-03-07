import { ChevronDown, ChevronsDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useChatProvider } from '../../contexts/chatContext';
import { useAssistantGuide } from '../../contexts/AssistantGuideContext';
import { ChatContainer } from './ChatContainer';
import { ChatInput } from './ChatInput';
import { BrowserViewer } from './BrowserViewer';
import { TraceDrawer } from './TraceDrawer';
import { EmailTabs } from '../email/EmailTabs';

const STORAGE_EXPANDED_KEY = 'hello_chat_dock_expanded_v1';

function parseStoredBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
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
  onRequestMinimize?: () => void;
};

export function ChatDock({
  onHeightChange,
  fullHeight = false,
  forceExpanded = false,
  embedded = false,
  collapseSignal,
  onExpandedChange,
  onRequestMinimize,
}: ChatDockProps) {
  const [expanded, setExpanded] = useState(() => parseStoredBool(STORAGE_EXPANDED_KEY, false));
  const [traceOpen, setTraceOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const collapseSignalRef = useRef<number | null>(null);
  const onHeightChangeRef = useRef(onHeightChange);
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
  const [trackedGlassCutout, setTrackedGlassCutout] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [glassReady, setGlassReady] = useState(false);
  const [contentAvoidanceZone, setContentAvoidanceZone] = useState<{ top: number; height: number; width: number } | null>(null);
  const { guideState } = useAssistantGuide();
  const {
    messages,
    thoughtState,
    isTyping,
    assistantStreamingText,
    chatModelSelection,
    plannerModelSelection,
    setChatModelSelection,
    setPlannerModelSelection,
    chatModelOptions,
    plannerModelOptions,
    localRuntimeAvailable,
    localRuntimeLabel,
    sendMessage,
    uploadFiles,
    stopAssistantResponse,
    handleAction,
    browserViewerOpen,
    closeBrowserViewer,
    salesforceSaveUrl,
    salesforceSearch,
    salesforceSkip,
    sessions,
    activeSessionId,
    createSession,
    setActiveSession,
    guidanceActive,
  } = useChatProvider();
  const isExpanded = forceExpanded || expanded;

  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  }, [onHeightChange]);

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
    const id = window.requestAnimationFrame(() => {
      setTraceOpen(false);
      setExpanded(false);
    });
    return () => window.cancelAnimationFrame(id);
  }, [collapseSignal]);

  useEffect(() => {
    if (forceExpanded) return;
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_EXPANDED_KEY, expanded ? '1' : '0');
  }, [expanded, forceExpanded]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return;
    if (lastMessage.id === lastMessageIdRef.current) return;
    lastMessageIdRef.current = lastMessage.id;
    const id = window.requestAnimationFrame(() => {
      setExpanded(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, [messages]);

  useEffect(() => {
    if (!isTyping) return;
    const id = window.requestAnimationFrame(() => {
      setExpanded(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, [isTyping]);

  useEffect(() => {
    if (!hostRef.current) return;
    const node = hostRef.current;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      setHostSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) return prev;
        return { width: nextWidth, height: nextHeight };
      });
      onHeightChangeRef.current(Math.ceil(rect.height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [embedded, expanded, forceExpanded]);

  useEffect(() => {
    if (!guidanceActive || !guideState.highlightedElementId || !hostRef.current) {
      setTrackedGlassCutout((prev) => (prev === null ? prev : null));
      setGlassReady((prev) => (prev ? false : prev));
      setContentAvoidanceZone((prev) => (prev === null ? prev : null));
      return;
    }
    let frameId = 0;
    const update = () => {
      const host = hostRef.current;
      const body = bodyRef.current;
      const target = document.querySelector<HTMLElement>(`[data-assistant-id="${guideState.highlightedElementId}"]`);
      if (!host || !body || !target) {
        setTrackedGlassCutout((prev) => (prev === null ? prev : null));
        setContentAvoidanceZone((prev) => (prev === null ? prev : null));
        frameId = window.requestAnimationFrame(update);
        return;
      }
      const hostRect = host.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const pad = 28;
      const left = Math.max(0, targetRect.left - hostRect.left - pad);
      const top = Math.max(0, targetRect.top - hostRect.top - pad);
      const right = Math.min(hostRect.width, targetRect.right - hostRect.left + pad);
      const bottom = Math.min(hostRect.height, targetRect.bottom - hostRect.top + pad);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      if (width > 0 && height > 0) {
        setTrackedGlassCutout((prev) => {
          if (
            prev &&
            prev.left === left &&
            prev.top === top &&
            prev.width === width &&
            prev.height === height
          ) {
            return prev;
          }
          return { left, top, width, height };
        });
      } else {
        setTrackedGlassCutout((prev) => (prev === null ? prev : null));
      }
      const targetStartsOnRight = targetRect.left > bodyRect.left + bodyRect.width * 0.4;
      const avoidanceTop = Math.max(0, Math.round(targetRect.top - bodyRect.top - pad));
      const avoidanceBottom = Math.min(bodyRect.height, Math.round(targetRect.bottom - bodyRect.top + pad));
      const avoidanceHeight = Math.max(0, avoidanceBottom - avoidanceTop);
      const laneWidth = Math.max(0, Math.round(targetRect.left - bodyRect.left - pad));
      const avoidanceWidth = Math.max(0, Math.round(bodyRect.width - laneWidth));
      if (targetStartsOnRight && avoidanceHeight > 0 && avoidanceWidth > 0 && laneWidth > 280) {
        const nextZone = {
          top: avoidanceTop,
          height: avoidanceHeight,
          width: Math.min(avoidanceWidth, Math.round(bodyRect.width * 0.72)),
        };
        setContentAvoidanceZone((prev) => {
          if (
            prev &&
            prev.top === nextZone.top &&
            prev.height === nextZone.height &&
            prev.width === nextZone.width
          ) {
            return prev;
          }
          return nextZone;
        });
      } else {
        setContentAvoidanceZone((prev) => (prev === null ? prev : null));
      }
      frameId = window.requestAnimationFrame(update);
    };
    frameId = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frameId);
  }, [guidanceActive, guideState.highlightedElementId, guideState.pointerMode]);

  useEffect(() => {
    if (!guidanceActive) {
      setGlassReady((prev) => (prev ? false : prev));
      return;
    }
    if (glassReady) return;
    setGlassReady(false);
    const timeoutId = window.setTimeout(() => {
      setGlassReady(true);
    }, 980);
    return () => window.clearTimeout(timeoutId);
  }, [guidanceActive, glassReady]);

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
      chatModelOptions={chatModelOptions}
      plannerModelOptions={plannerModelOptions}
      chatModel={chatModelSelection}
      plannerModel={plannerModelSelection}
      onChatModelChange={setChatModelSelection}
      onPlannerModelChange={setPlannerModelSelection}
      localRuntimeAvailable={localRuntimeAvailable}
      localRuntimeLabel={localRuntimeLabel}
    />
  );

  if (embedded && !isExpanded) {
    return (
      <>
        <section
          ref={hostRef}
          className={`relative flex min-h-0 flex-col overflow-hidden border-0 ${guidanceActive ? 'bg-transparent' : 'bg-surface'}`}
        >
          {input}
        </section>
        <TraceDrawer open={traceOpen} onClose={() => setTraceOpen(false)} />
      </>
    );
  }

  const activeCutout = trackedGlassCutout;
  const cutoutRight = activeCutout ? Math.max(0, hostSize.width - (activeCutout.left + activeCutout.width)) : 0;
  const cutoutBottom = activeCutout ? Math.max(0, hostSize.height - (activeCutout.top + activeCutout.height)) : 0;
  const guidanceChromeClass = activeCutout ? 'bg-white/4' : 'bg-white/4 backdrop-blur-[4px]';
  const guidanceFooterClass = activeCutout ? 'border-white/15 bg-white/4' : 'border-white/15 bg-white/6 backdrop-blur-[4px]';

  return (
    <>
      <section
        ref={hostRef}
        data-assistant-chat-dock="true"
        className={
          embedded
            ? `relative z-40 flex h-full min-h-0 flex-col overflow-hidden border-0 ${guidanceActive ? 'pointer-events-none bg-transparent' : 'bg-surface'}`
            : fullHeight
              ? 'absolute inset-2 z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl md:inset-3'
              : `absolute bottom-2 left-1/2 z-40 flex flex-col w-[min(1180px,calc(100%-1rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl md:bottom-3 md:w-[min(1260px,calc(100%-1.5rem))] ${
                isExpanded ? 'h-[52vh] min-h-[320px] max-h-[680px]' : 'h-[120px]'
                }`
        }
      >
        <div
          className={
            guidanceActive
              ? 'pointer-events-none relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/30 shadow-[0_20px_60px_rgba(15,23,42,0.12)]'
              : 'flex h-full min-h-0 flex-col'
          }
        >
          {guidanceActive ? (
            <div className="pointer-events-none absolute inset-0 z-0">
              {activeCutout ? (
                <>
                  <div
                    className="absolute left-0 right-0 top-0 bg-white/10 backdrop-blur-[4px] transition-opacity duration-300"
                    style={{ height: activeCutout.top, opacity: glassReady ? 1 : 0.7 }}
                  />
                  <div
                    className="absolute left-0 bg-white/10 backdrop-blur-[4px] transition-opacity duration-300"
                    style={{ top: activeCutout.top, width: activeCutout.left, height: activeCutout.height, opacity: glassReady ? 1 : 0.7 }}
                  />
                  <div
                    className="absolute right-0 bg-white/10 backdrop-blur-[4px] transition-opacity duration-300"
                    style={{ top: activeCutout.top, width: cutoutRight, height: activeCutout.height, opacity: glassReady ? 1 : 0.7 }}
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-white/10 backdrop-blur-[4px] transition-opacity duration-300"
                    style={{ height: cutoutBottom, opacity: glassReady ? 1 : 0.7 }}
                  />
                </>
              ) : (
                <div className="absolute inset-0 bg-white/10 backdrop-blur-[4px]" />
              )}
            </div>
          ) : null}
          <header className={`relative z-10 border-b px-2.5 pt-2 ${guidanceActive ? `pointer-events-auto border-white/18 ${guidanceChromeClass}` : 'border-border/70 bg-transparent'}`}>
          <div className="flex items-end justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-end gap-1.5">
              <EmailTabs tabs={sessions} activeTab={activeSessionId} onSelectTab={setActiveSession} className="min-w-0 flex-1" />
              <button
                type="button"
                onClick={createSession}
                className="mb-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover/70 hover:text-text"
                title="Start a new chat session"
                aria-label="Start a new chat session"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-1 flex h-8 shrink-0 items-center gap-1.5">
              <span className="h-5 w-px bg-border/70" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setTraceOpen((prev) => !prev)}
                aria-pressed={traceOpen}
                className={`inline-flex h-8 items-center rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                  traceOpen
                    ? 'bg-surface-hover text-text'
                    : 'bg-bg/70 text-text-muted hover:bg-surface-hover/80 hover:text-text'
                }`}
                title={traceOpen ? 'Hide trace' : 'Show trace'}
              >
                Trace
              </button>
              {onRequestMinimize ? (
                <button
                  type="button"
                  onClick={onRequestMinimize}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-text-muted transition-colors hover:bg-surface-hover/70 hover:text-text"
                  title="Minimize assistant dock"
                  aria-label="Minimize assistant dock"
                >
                  <ChevronsDown className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {!forceExpanded ? (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => (forceExpanded ? true : !prev))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover/70 hover:text-text"
                  title={isExpanded ? 'Collapse chat dock' : 'Expand chat dock'}
                  aria-label={isExpanded ? 'Collapse chat dock' : 'Expand chat dock'}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-0' : 'rotate-180'}`} />
                </button>
              ) : null}
            </div>
          </div>
          </header>

          <div ref={bodyRef} className="pointer-events-none relative z-10 min-h-0 flex flex-1 flex-col">
            <div className="pointer-events-none isolate min-h-0 flex flex-1 flex-col">
              {browserViewerOpen ? (
                <div className={`pointer-events-auto relative z-20 px-2 pb-1 pt-1.5 ${guidanceActive ? 'bg-transparent' : ''}`}>
                  <BrowserViewer isOpen={browserViewerOpen} onClose={closeBrowserViewer} />
                </div>
              ) : null}
              <div className={`${guideState.pointerMode === 'passthrough' ? 'pointer-events-none' : 'pointer-events-auto'} relative z-20 min-h-0 flex-1`}>
                <div className="h-full overflow-hidden">
                  <ChatContainer
                    messages={messages}
                    thoughtState={thoughtState}
                    isTyping={isTyping}
                    typingText={assistantStreamingText}
                    streamTopOffsetPx={54}
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
                    avoidanceZone={contentAvoidanceZone}
                  />
                </div>
              </div>
            </div>

            <div className={`relative z-10 pointer-events-auto border-t ${guidanceActive ? guidanceFooterClass : 'border-border/70 bg-surface'}`}>{input}</div>
          </div>
        </div>
      </section>
      <TraceDrawer open={traceOpen} onClose={() => setTraceOpen(false)} />
    </>
  );
}
