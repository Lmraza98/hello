import { useMemo, useState, type KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { SLASH_COMMANDS } from '../../chat/slashCommands';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Ask me to find contacts, create campaigns, send emails...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

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

  return (
    <div className="border-t border-border bg-surface p-3">
      <div className="relative flex items-end gap-2">
        <textarea
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-h-[42px] max-h-36 flex-1 resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
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
          className="inline-flex h-[42px] items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="hidden sm:inline">Send</span>
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
