import { BaseModal } from './BaseModal';
import { AlertTriangle } from 'lucide-react';

/**
 * Modal confirmation dialog that replaces native `window.confirm()`.
 * Renders a themed modal with a warning icon, message, and cancel/confirm buttons.
 *
 * @example
 * const [showConfirm, setShowConfirm] = useState(false);
 *
 * <ConfirmDialog
 *   open={showConfirm}
 *   title="Delete company?"
 *   message="This action cannot be undone."
 *   confirmLabel="Delete"
 *   variant="danger"
 *   onConfirm={() => { deleteMutation.mutate(id); setShowConfirm(false); }}
 *   onCancel={() => setShowConfirm(false)}
 * />
 */
export type ConfirmDialogProps = {
  /** Whether the dialog is visible */
  open: boolean;
  /** Dialog title */
  title: string;
  /** Body message explaining the action */
  message: string;
  /** Text for the confirm button (default: "Confirm") */
  confirmLabel?: string;
  /** Text for the cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** "danger" = red confirm button, "default" = accent confirm button */
  variant?: 'danger' | 'default';
  /** Called when the user confirms */
  onConfirm: () => void;
  /** Called when the user cancels or closes the dialog */
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const confirmClass =
    variant === 'danger'
      ? 'px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors'
      : 'px-5 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors';

  return (
    <BaseModal
      title={title}
      onClose={onCancel}
      maxWidth="max-w-sm"
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
          >
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className={confirmClass}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
        </div>
        <p className="text-sm text-text-muted pt-2">{message}</p>
      </div>
    </BaseModal>
  );
}
