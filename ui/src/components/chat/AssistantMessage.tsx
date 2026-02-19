import { useMemo, useState, type ReactNode } from 'react';
import { uiTokens } from './uiTokens';

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; lang: string; code: string };

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.startsWith('`') && part.endsWith('`')) {
      nodes.push(
        <code key={`c-${i}`} className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em] text-slate-800">
          {part.slice(1, -1)}
        </code>
      );
      continue;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={`b-${i}`} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>);
      continue;
    }
    nodes.push(<span key={`t-${i}`}>{part}</span>);
  }
  return nodes;
}

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    const numberedHeading = line.match(/^(\d+)\)\s+(.+)$/) || line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedHeading && numberedHeading[2].length > 3) {
      blocks.push({ type: 'heading', level: 3, text: `${numberedHeading[1]}. ${numberedHeading[2]}` });
      i += 1;
      continue;
    }
    if (/^(\-|\*)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^(\-|\*)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^(\-|\*)\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }
    const paragraph: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^(\-|\*|\d+\.)\s+/.test(lines[i]) &&
      !/^(\d+)\)\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

function renderBlock(block: Block, idx: number): ReactNode {
  if (block.type === 'code') {
    return (
      <pre key={`pre-${idx}`} className="overflow-x-auto rounded-lg border border-border/70 bg-slate-950 p-3 text-xs text-slate-100">
        {block.lang ? <div className="mb-1 text-[10px] uppercase text-slate-400">{block.lang}</div> : null}
        <code>{block.code}</code>
      </pre>
    );
  }
  if (block.type === 'heading') {
    const cls = block.level === 1
      ? 'mt-5 text-lg font-semibold text-slate-700'
      : block.level === 2
        ? 'mt-4 text-base font-semibold text-slate-700'
        : 'mt-3 text-sm font-semibold text-slate-700';
    return (
      <h3 key={`h-${idx}`} className={cls}>
        {renderInline(block.text)}
      </h3>
    );
  }
  if (block.type === 'ul') {
    return (
      <ul key={`ul-${idx}`} className="list-disc space-y-1.5 pl-5 leading-6">
        {block.items.map((item, i) => (
          <li key={`uli-${i}`}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  if (block.type === 'ol') {
    return (
      <ol key={`ol-${idx}`} className="list-decimal space-y-1.5 pl-5 leading-6">
        {block.items.map((item, i) => (
          <li key={`oli-${i}`}>{renderInline(item)}</li>
        ))}
      </ol>
    );
  }
  return (
    <p key={`p-${idx}`} className="mb-2.5 leading-6 text-[14px] text-slate-800 last:mb-0">
      {renderInline(block.text)}
    </p>
  );
}

export function AssistantMessage({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const isLong = blocks.length > 12 || content.length > 1800;
  const [expanded, setExpanded] = useState(!isLong);
  const shown = expanded ? blocks : blocks.slice(0, 8);

  return (
    <div className={`${uiTokens.widths.assistantWrap} text-text`}>
      <div className={`assistant-markdown ${uiTokens.widths.assistantText} animate-assistant-fade border-l border-border/80 pl-3`}>
        {shown.map((block, idx) => renderBlock(block, idx))}
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-1 text-xs font-medium text-text-muted hover:text-text"
          >
            {expanded ? 'Show less' : `Show more (${blocks.length - shown.length} sections)`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
