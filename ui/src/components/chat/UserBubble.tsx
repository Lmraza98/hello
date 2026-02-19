import type { ReactNode } from 'react';
import { uiTokens } from './uiTokens';

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${uiTokens.widths.userBubble} ${uiTokens.radii.user} bg-accent-hover px-4 py-2 text-sm text-white ${uiTokens.elevation.soft}`}
    >
      {children}
    </div>
  );
}
