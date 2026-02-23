import type { WorkspaceMode } from '../shell/workspaceLayout';
import type { WorkspaceInteractionState } from '../shell/workspaceLayout';
import { ContextualInteractionPanel } from '../shell/ContextualInteractionPanel';
import { WorkspaceSurface } from '../shell/WorkspaceSurface';

type ContextPreviewDrawerProps = {
  open: boolean;
  mode: WorkspaceMode;
  mobile: boolean;
  interaction: WorkspaceInteractionState | null;
  title?: string;
  subtitle?: string;
  onOpen: () => void;
  onClose: () => void;
  onModeChange: (mode: WorkspaceMode) => void;
  onOpenRoute: (route: string) => void;
  onDismiss: () => void;
};

export function ContextPreviewDrawer({
  open,
  mode,
  mobile,
  interaction,
  title = 'Context Preview',
  subtitle = 'Contextual components surfaced by the assistant',
  onOpen,
  onClose,
  onModeChange,
  onOpenRoute,
  onDismiss,
}: ContextPreviewDrawerProps) {
  return (
    <WorkspaceSurface
      open={open}
      mode={mode}
      mobile={mobile}
      title={title}
      subtitle={subtitle}
      closedLabel="Open Preview"
      onOpen={onOpen}
      onClose={onClose}
      onModeChange={onModeChange}
    >
      {interaction ? (
        <ContextualInteractionPanel
          interaction={interaction}
          onOpenRoute={onOpenRoute}
          onDismiss={onDismiss}
        />
      ) : null}
    </WorkspaceSurface>
  );
}
