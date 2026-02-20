import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Paperclip, SendHorizontal } from 'lucide-react';
import { SLASH_COMMANDS } from '../../chat/slashCommands';

interface ChatInputProps {
  onSend: (text: string) => void;
  onUploadFiles?: (files: File[]) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  placeholder?: string;
  onFocus?: () => void;
}

export function ChatInput({
  onSend,
  onUploadFiles,
  disabled = false,
  isStreaming = false,
  onStop,
  placeholder = 'Ask for leads, campaigns, or workflow actions...',
  onFocus,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const slashQuery = value.trimStart();
  const showSlashMenu = slashQuery.startsWith('/');
  const commandToken = showSlashMenu ? slashQuery.slice(1).split(/\s+/)[0].toLowerCase() : '';
  const filteredCommands = useMemo(
    () =>
      showSlashMenu
        ? SLASH_COMMANDS.filter((cmd) => cmd.command.slice(1).startsWith(commandToken))
        : [],
    [commandToken, showSlashMenu]
  );

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setValue('');
    setHighlightedIndex(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((prev) =>
          prev === 0 ? filteredCommands.length - 1 : prev - 1
        );
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const selected = filteredCommands[highlightedIndex] || filteredCommands[0];
        setValue(`${selected.command} `);
        setHighlightedIndex(0);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !value.trim().includes(' ')) {
        event.preventDefault();
        const selected = filteredCommands[highlightedIndex] || filteredCommands[0];
        setValue(`${selected.command} `);
        setHighlightedIndex(0);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const onDropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    if (!onUploadFiles) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 0) {
      onUploadFiles(files);
    }
  };

  return (
    <div
      className={`bg-surface p-3 transition-colors ${isDraggingFile ? 'bg-accent/5' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget === event.target) setIsDraggingFile(false);
      }}
      onDrop={onDropFiles}
    >
      <div className="relative flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(event) => {
            if (!onUploadFiles) return;
            const files = Array.from(event.target.files || []);
            if (files.length > 0) onUploadFiles(files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!onUploadFiles || disabled}
          className="inline-flex h-[44px] items-center rounded-lg border border-border bg-bg px-2.5 text-text-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
          title="Attach files"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => onFocus?.()}
          placeholder={placeholder}
          className="min-h-[60px] max-h-40 flex-1 resize-y rounded-lg border border-border bg-bg px-3.5 py-3 text-sm text-text outline-none placeholder:text-text-dim transition-shadow duration-150 focus:border-accent focus:ring-2 focus:ring-accent/30 focus:shadow-[0_0_0_3px_rgba(79,70,229,0.12)]"
        />
        {showSlashMenu && filteredCommands.length > 0 ? (
          <div className="absolute bottom-[calc(100%+8px)] left-0 right-14 max-h-56 overflow-y-auto rounded-md border border-border bg-bg shadow-lg">
            {filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.command}
                type="button"
                className={`w-full px-3 py-2 text-left transition-colors ${
                  idx === highlightedIndex ? 'bg-surface-hover' : 'bg-bg'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setValue(`${cmd.command} `);
                  setHighlightedIndex(0);
                }}
              >
                <div className="text-xs font-medium text-text">{cmd.command} - {cmd.label}</div>
                <div className="mt-0.5 text-[11px] text-text-dim">{cmd.description}</div>
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          className="inline-flex h-[44px] items-center gap-1 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="hidden sm:inline">Send</span>
          <SendHorizontal className="h-4 w-4" />
        </button>
        {isStreaming ? (
          <button
            type="button"
            onClick={() => onStop?.()}
            className="inline-flex h-[44px] items-center rounded-lg border border-border bg-bg px-2.5 text-xs font-medium text-text-muted hover:bg-surface-hover"
          >
            Stop
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-[10px] text-text-dim">
        Enter to send, Shift+Enter for newline. Drag files here to upload to documents.
      </p>
    </div>
  );
}
