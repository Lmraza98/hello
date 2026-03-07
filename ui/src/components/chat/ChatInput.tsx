import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ChevronUp, Paperclip, SendHorizontal, Square } from 'lucide-react';
import { SLASH_COMMANDS } from '../../chat/slashCommands';

interface ChatInputProps {
  onSend: (text: string) => void;
  onUploadFiles?: (files: File[]) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  placeholder?: string;
  onFocus?: () => void;
  chatModelOptions?: Array<{ value: string; label: string }>;
  plannerModelOptions?: Array<{ value: string; label: string }>;
  chatModel?: string;
  plannerModel?: string;
  onChatModelChange?: (model: string) => void;
  onPlannerModelChange?: (model: string) => void;
  localRuntimeAvailable?: boolean;
  localRuntimeLabel?: string;
}

type ModelOption = { value: string; label: string };

function resolveModelLabel(value: string, options: ModelOption[]): string {
  if (value === 'auto') return 'Auto';
  return options.find((item) => item.value === value)?.label || value;
}

function DropUpSelect({
  label,
  value,
  options,
  open,
  onToggle,
  onSelect,
}: {
  label: string;
  value: string;
  options: ModelOption[];
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border/70 bg-surface px-2 text-[11px] text-text-muted hover:bg-surface-hover"
      >
        <span className="text-text-dim">{label}:</span>
        <span className="max-w-[116px] truncate text-text">{resolveModelLabel(value, options)}</span>
        <ChevronUp className={`h-3 w-3 text-text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="absolute bottom-[calc(100%+6px)] left-0 z-30 max-h-52 min-w-[180px] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect('auto');
            }}
            className={`block w-full px-2.5 py-1.5 text-left text-xs hover:bg-surface-hover ${value === 'auto' ? 'bg-surface-hover text-text' : 'text-text-muted'}`}
          >
            Auto
          </button>
          {options.map((option) => (
            <button
              key={`${label}-${option.value}`}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(option.value);
              }}
              className={`block w-full px-2.5 py-1.5 text-left text-xs hover:bg-surface-hover ${value === option.value ? 'bg-surface-hover text-text' : 'text-text-muted'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChatInput({
  onSend,
  onUploadFiles,
  disabled = false,
  isStreaming = false,
  onStop,
  placeholder = 'Ask for leads, campaigns, or workflow actions...',
  onFocus,
  chatModelOptions = [],
  plannerModelOptions = [],
  chatModel = 'auto',
  plannerModel = 'auto',
  onChatModelChange,
  onPlannerModelChange,
  localRuntimeAvailable = false,
  localRuntimeLabel = 'ollama',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [openMenu, setOpenMenu] = useState<'chat' | 'planner' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

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
    setOpenMenu(null);
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

  useEffect(() => {
    if (!openMenu) return;
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (hostRef.current?.contains(target)) return;
      setOpenMenu(null);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [openMenu]);

  return (
    <div
      ref={hostRef}
      className={`bg-surface px-2 py-1.5 transition-colors ${isDraggingFile ? 'bg-accent/5' : ''}`}
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
      <div className="relative rounded-2xl border border-border bg-bg px-2 py-2">
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
        <textarea
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => onFocus?.()}
          placeholder={placeholder}
          className="min-h-8 max-h-28 w-full resize-none bg-transparent px-2 py-1 text-sm text-text outline-none placeholder:text-text-dim"
        />
        {showSlashMenu && filteredCommands.length > 0 ? (
          <div className="absolute bottom-[calc(100%+8px)] left-2 right-2 z-30 max-h-56 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
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

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!onUploadFiles || disabled}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-surface text-text-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
              title="Attach files"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
                localRuntimeAvailable ? 'border-emerald-300/60 bg-emerald-50 text-emerald-700' : 'border-amber-300/60 bg-amber-50 text-amber-700'
              }`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${localRuntimeAvailable ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {localRuntimeLabel}
            </span>
            <DropUpSelect
              label="Chat"
              value={chatModel}
              options={chatModelOptions}
              open={openMenu === 'chat'}
              onToggle={() => setOpenMenu((prev) => (prev === 'chat' ? null : 'chat'))}
              onSelect={(nextValue) => {
                onChatModelChange?.(nextValue);
                setOpenMenu(null);
              }}
            />
            <DropUpSelect
              label="Planner"
              value={plannerModel}
              options={plannerModelOptions}
              open={openMenu === 'planner'}
              onToggle={() => setOpenMenu((prev) => (prev === 'planner' ? null : 'planner'))}
              onSelect={(nextValue) => {
                onPlannerModelChange?.(nextValue);
                setOpenMenu(null);
              }}
            />
          </div>
          {isStreaming ? (
            <button
              type="button"
              onClick={() => onStop?.()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text-muted hover:bg-surface-hover"
              title="Stop generation"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || value.trim().length === 0}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              title="Send message"
            >
              <SendHorizontal className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
