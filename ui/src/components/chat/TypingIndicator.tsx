import type { RefObject } from 'react';

export function TypingIndicator({
  text = '',
  caretRef,
  bubbleRef,
}: {
  text?: string;
  caretRef?: RefObject<HTMLSpanElement | null>;
  bubbleRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex justify-start">
      <div ref={bubbleRef} className="inline-flex max-w-[85%] items-center px-0 py-0 text-sm text-text opacity-90">
        {text ? <span className="whitespace-pre-wrap">{text}</span> : null}
        <span ref={caretRef} className="ui-stream-cursor" />
      </div>
    </div>
  );
}
