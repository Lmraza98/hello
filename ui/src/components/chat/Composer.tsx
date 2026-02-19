import { ChatInput } from './ChatInput';
import { uiTokens } from './uiTokens';

export function Composer({
  onSend,
  onUploadFiles,
  disabled,
  isStreaming,
  onStop,
}: {
  onSend: (text: string) => void;
  onUploadFiles?: (files: File[]) => void;
  disabled: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
}) {
  return (
    <div className={`sticky bottom-0 z-10 border-t border-border bg-surface ${uiTokens.elevation.composer}`}>
      <ChatInput
        onSend={onSend}
        onUploadFiles={onUploadFiles}
        disabled={disabled}
        isStreaming={Boolean(isStreaming)}
        onStop={onStop}
      />
    </div>
  );
}
