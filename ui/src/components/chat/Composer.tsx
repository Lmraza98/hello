import { ChatInput } from './ChatInput';
import { uiTokens } from './uiTokens';

export function Composer({
  onSend,
  onUploadFiles,
  disabled,
  isStreaming,
  onStop,
  chatModelOptions,
  plannerModelOptions,
  chatModel,
  plannerModel,
  onChatModelChange,
  onPlannerModelChange,
  localRuntimeAvailable,
  localRuntimeLabel,
}: {
  onSend: (text: string) => void;
  onUploadFiles?: (files: File[]) => void;
  disabled: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  chatModelOptions?: Array<{ value: string; label: string }>;
  plannerModelOptions?: Array<{ value: string; label: string }>;
  chatModel?: string;
  plannerModel?: string;
  onChatModelChange?: (model: string) => void;
  onPlannerModelChange?: (model: string) => void;
  localRuntimeAvailable?: boolean;
  localRuntimeLabel?: string;
}) {
  return (
    <div className={`sticky bottom-0 z-10 border-t border-border bg-surface ${uiTokens.elevation.composer}`}>
      <ChatInput
        onSend={onSend}
        onUploadFiles={onUploadFiles}
        disabled={disabled}
        isStreaming={Boolean(isStreaming)}
        onStop={onStop}
        chatModelOptions={chatModelOptions}
        plannerModelOptions={plannerModelOptions}
        chatModel={chatModel}
        plannerModel={plannerModel}
        onChatModelChange={onChatModelChange}
        onPlannerModelChange={onPlannerModelChange}
        localRuntimeAvailable={localRuntimeAvailable}
        localRuntimeLabel={localRuntimeLabel}
      />
    </div>
  );
}
