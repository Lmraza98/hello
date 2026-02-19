import type { ReactNode } from 'react';

export function ChatLayout({
  header,
  body,
  composer,
}: {
  header: ReactNode;
  body: ReactNode;
  composer: ReactNode;
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg">
      {header}
      {body}
      {composer}
    </div>
  );
}

