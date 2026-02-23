import { ChatDock } from '../chat/ChatDock';

type DockConfig = {
  onHeightChange: (heightPx: number) => void;
  fullHeight?: boolean;
  forceExpanded?: boolean;
  embedded?: boolean;
  collapseSignal?: number;
  onExpandedChange?: (expanded: boolean) => void;
};

type GlobalAssistantPanelProps = {
  dock: DockConfig;
};

export function GlobalAssistantPanel({ dock }: GlobalAssistantPanelProps) {
  return <ChatDock {...dock} />;
}
