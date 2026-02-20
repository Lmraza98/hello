import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatMessage as ChatMessageType, DashboardDataBridge, ThoughtUIState } from '../../types/chat';
import { ChatLayout } from './ChatLayout';
import { ChatMessage } from './ChatMessage';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { MessageRow } from './MessageRow';
import { MessageGroup } from './MessageGroup';
import { ThinkingMetaCard } from './ThinkingMetaCard';
import { ThinkingMicroBubble } from './ThinkingMicroBubble';
import { TypingIndicator } from './TypingIndicator';
import { uiTokens } from './uiTokens';

interface ChatContainerProps {
  messages: ChatMessageType[];
  thoughtState: ThoughtUIState;
  isTyping: boolean;
  typingText?: string;
  streamTopOffsetPx?: number;
  onSendMessage: (text: string) => void;
  onUploadFiles?: (files: File[]) => void;
  onStopStreaming?: () => void;
  onAction: (actionValue: string) => void;
  onSalesforceSaveUrl?: (contactId: number, contactName: string, url: string, promptId: string) => Promise<void>;
  onSalesforceSearch?: (contactId: number, contactName: string, promptId: string) => Promise<void>;
  onSalesforceSkip?: (contactId: number, promptId: string) => Promise<void>;
  dashboardData?: DashboardDataBridge;
  sectionBar?: ReactNode;
  showComposer?: boolean;
}

type VisibleMessageItem = {
  message: ChatMessageType;
  repeatCount: number;
};

function isNearBottom(container: HTMLDivElement, thresholdPx = 120): boolean {
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= thresholdPx;
}

function scrollToBottom(container: HTMLDivElement, behavior: ScrollBehavior = 'smooth'): void {
  container.scrollTo({ top: container.scrollHeight, behavior });
}

function animateScrollTo(
  scrollEl: HTMLDivElement,
  targetTop: number,
  durationMs = 460
): Promise<void> {
  const startTop = scrollEl.scrollTop;
  const delta = targetTop - startTop;
  if (Math.abs(delta) < 1) return Promise.resolve();
  const start = performance.now();

  return new Promise((resolve) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeInOutSine for a calmer, more gradual motion profile.
      const eased = -(Math.cos(Math.PI * t) - 1) / 2;
      scrollEl.scrollTop = startTop + delta * eased;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

function getTopOffsetTarget(
  scrollEl: HTMLDivElement,
  msgEl: HTMLElement,
  topOffsetPx: number
): number {
  const desired =
    (msgEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top) +
    scrollEl.scrollTop -
    topOffsetPx;
  const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  return Math.max(0, Math.min(max, desired));
}

export function ChatContainer({
  messages,
  thoughtState,
  isTyping,
  typingText,
  streamTopOffsetPx = 16,
  onSendMessage,
  onUploadFiles,
  onStopStreaming,
  onAction,
  onSalesforceSaveUrl,
  onSalesforceSearch,
  onSalesforceSkip,
  dashboardData,
  sectionBar,
  showComposer = true,
}: ChatContainerProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const streamStartRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLSpanElement | null>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [tailSpacerHeight, setTailSpacerHeight] = useState(0);
  const prevTypingRef = useRef(false);
  const lockPostStreamRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const postStreamHoldUntilRef = useRef(0);
  const spacerBufferPx = 120;

  const visibleMessages = useMemo(
    () =>
      messages.filter((message, idx) => {
        const next = idx < messages.length - 1 ? messages[idx + 1] : null;
        const isRedundantConfirmPrompt =
          message.type === 'text' &&
          message.sender === 'bot' &&
          /(confirm to run these planned actions\?|confirm to continue\?)/i.test(message.content || '') &&
          Boolean(
            next &&
              next.type === 'action_buttons' &&
              next.buttons.some((button) => button.value === 'tool_plan_confirm')
          );
        return !isRedundantConfirmPrompt;
      }),
    [messages]
  );

  const dedupedMessages = useMemo<VisibleMessageItem[]>(() => {
    const items: VisibleMessageItem[] = [];
    for (const message of visibleMessages) {
      const last = items[items.length - 1];
      const canMerge =
        Boolean(last) &&
        last.message.type === 'text' &&
        message.type === 'text' &&
        last.message.sender === message.sender &&
        (last.message.content || '').trim() === (message.content || '').trim();
      if (canMerge && last) {
        last.repeatCount += 1;
        continue;
      }
      items.push({ message, repeatCount: 1 });
    }
    return items;
  }, [visibleMessages]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;

    const nearBottom = isNearBottom(container, 120);
    const streamingJustStarted = isTyping && !prevTypingRef.current;
    const streamingJustEnded = !isTyping && prevTypingRef.current;
    if (streamingJustStarted) {
      // One-time start alignment near top of viewport when streaming begins.
      if (!userScrolled || nearBottom) {
        // Reserve temporary tail space so the last message can be positioned near top.
        setTailSpacerHeight(Math.max(0, Math.round(container.clientHeight - streamTopOffsetPx + spacerBufferPx)));
        if (streamStartRef.current) {
          programmaticScrollRef.current = true;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (listRef.current && streamStartRef.current) {
                // Tune this value to control where the streaming bubble starts.
                const target = getTopOffsetTarget(listRef.current, streamStartRef.current, streamTopOffsetPx);
                void animateScrollTo(listRef.current, target, 460).finally(() => {
                  requestAnimationFrame(() => {
                    programmaticScrollRef.current = false;
                  });
                });
              }
            });
          });
        }
        lockPostStreamRef.current = false;
        postStreamHoldUntilRef.current = 0;
        setUserScrolled(false);
        setShowJumpToLatest(false);
      }
      prevTypingRef.current = true;
      return;
    }

    if (isTyping) {
      // Follow caret while user is still in auto-follow mode.
      if (!lockPostStreamRef.current && !userScrolled) {
        const caret = caretRef.current?.getBoundingClientRect();
        const viewport = container.getBoundingClientRect();
        const bottomPad = 24;
        if (caret && caret.bottom > viewport.bottom - bottomPad) {
          const delta = caret.bottom - (viewport.bottom - bottomPad);
          container.scrollTop += delta;
        }
        setShowJumpToLatest(false);
      } else {
        setShowJumpToLatest(true);
      }
    } else {
      if (streamingJustEnded) {
        // Hold position after stream end; do not snap back to bottom automatically.
        lockPostStreamRef.current = true;
        postStreamHoldUntilRef.current = performance.now() + 1500;
        // Collapse spacer only to the minimum needed to avoid browser scroll clamping.
        // If we collapse to 0 while anchored near top, some threads cannot support that
        // scrollTop and the browser clamps to the bottom (the visible "snap").
        const contentWithoutSpacer = Math.max(0, container.scrollHeight - tailSpacerHeight);
        const minSpacerToPreserveViewport = Math.max(
          0,
          Math.ceil(container.scrollTop + container.clientHeight - contentWithoutSpacer + 2)
        );
        setTailSpacerHeight(minSpacerToPreserveViewport);
      }
      prevTypingRef.current = false;
      const inHoldWindow = performance.now() < postStreamHoldUntilRef.current;
      if (!streamingJustEnded && !inHoldWindow && !lockPostStreamRef.current && !userScrolled && nearBottom) {
        programmaticScrollRef.current = true;
        scrollToBottom(container, 'smooth');
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
        setShowJumpToLatest(false);
      }
    }
  }, [visibleMessages, isTyping, typingText, userScrolled, tailSpacerHeight]);

  const groupedRows = useMemo(() => {
    const groups: Array<{ sender: 'user' | 'bot'; items: VisibleMessageItem[] }> = [];
    for (const item of dedupedMessages) {
      const msg = item.message;
      const last = groups[groups.length - 1];
      if (!last || last.sender !== msg.sender) {
        groups.push({ sender: msg.sender, items: [item] });
      } else {
        last.items.push(item);
      }
    }
    return groups;
  }, [dedupedMessages]);

  const hasStreamingText = Boolean((typingText || '').trim().length > 0);
  const showThoughtLayer = !hasStreamingText;

  return (
    <ChatLayout
      header={null}
      body={
        <>
          <MessageList
        containerRef={listRef}
        onScroll={(e) => {
          if (programmaticScrollRef.current) return;
          const node = e.currentTarget;
          const nearBottom = isNearBottom(node, 120);
          if (!nearBottom) {
            setUserScrolled(true);
            setShowJumpToLatest(true);
            return;
          }
          setUserScrolled(false);
          setShowJumpToLatest(false);
        }}
      >
        {groupedRows.map((group, groupIdx) => (
          <MessageRow
            key={`group-${groupIdx}-${group.items[0]?.message.id || groupIdx}`}
            gapClass={groupIdx === 0 ? 'mt-0' : uiTokens.spacing.speakerSwitchGap}
          >
            <MessageGroup role={group.sender === 'bot' ? 'assistant' : 'user'}>
              {group.items.map(({ message, repeatCount }) => (
                <div key={message.id}>
                  <ChatMessage
                    message={message}
                    onAction={onAction}
                    onSalesforceSaveUrl={onSalesforceSaveUrl}
                    onSalesforceSearch={onSalesforceSearch}
                    onSalesforceSkip={onSalesforceSkip}
                    dashboardData={dashboardData}
                  />
                  {repeatCount > 1 ? (
                    <div className={`mt-1 text-[10px] text-text-dim ${message.sender === 'user' ? 'text-right' : 'text-left'}`}>
                      Repeated {repeatCount}x
                    </div>
                  ) : null}
                </div>
              ))}
            </MessageGroup>
          </MessageRow>
        ))}
        {showThoughtLayer ? <ThinkingMicroBubble state={thoughtState} /> : null}
        {showThoughtLayer ? <ThinkingMetaCard state={thoughtState} /> : null}
        {isTyping ? (
          <TypingIndicator text={typingText || ''} caretRef={caretRef} bubbleRef={streamStartRef} />
        ) : null}
        <div style={{ height: `${tailSpacerHeight}px` }} />
        <div ref={bottomRef} />
      </MessageList>
      {showJumpToLatest ? (
        <div className="pointer-events-none absolute bottom-24 right-4 z-20">
          <button
            type="button"
            onClick={() => {
              const container = listRef.current;
              if (container) {
                programmaticScrollRef.current = true;
                scrollToBottom(container);
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    programmaticScrollRef.current = false;
                  });
                });
              }
              lockPostStreamRef.current = false;
              postStreamHoldUntilRef.current = 0;
              setTailSpacerHeight(0);
              setUserScrolled(false);
              setShowJumpToLatest(false);
            }}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface/90 px-2.5 py-0.5 text-[10px] text-text-muted shadow-sm hover:bg-surface"
          >
            Jump to latest
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {sectionBar}
      </>
    }
      composer={
        showComposer ? (
          <Composer
            onSend={onSendMessage}
            onUploadFiles={onUploadFiles}
            disabled={isTyping}
            isStreaming={isTyping}
            onStop={onStopStreaming}
          />
        ) : null
      }
    />
  );
}
