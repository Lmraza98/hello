import type { ReactNode } from 'react';

export function MessageGroup({
  role,
  children,
}: {
  role: 'user' | 'assistant';
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className={`flex items-center text-[10px] text-text-dim ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
        {role === 'assistant' ? <span className="uppercase tracking-wide">Assistant</span> : null}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
