import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Base modal with overlay, header, scrollable body, and optional footer.
 * Handles backdrop click-to-close and ESC key dismissal.
 * On mobile, slides up from the bottom; on desktop, centers in viewport.
 *
 * @example
 * <BaseModal title="Add Contact" onClose={onClose} footer={<button>Save</button>}>
 *   <form>...</form>
 * </BaseModal>
 *
 * @example Wide modal with header tabs
 * <BaseModal title="Templates" maxWidth="max-w-4xl" headerExtra={<TabBar />}>
 *   ...
 * </BaseModal>
 */
export type BaseModalProps = {
  /** Modal title shown in the header */
  title: string;
  /** Called when the user clicks the backdrop, close button, or presses ESC */
  onClose: () => void;
  /** Tailwind max-width class for the container (default: "max-w-lg") */
  maxWidth?: string;
  /** Modal body content */
  children: React.ReactNode;
  /** Footer content (typically cancel/submit buttons). Omit for no footer. */
  footer?: React.ReactNode;
  /** Extra content rendered beside the title (e.g. tab buttons) */
  headerExtra?: React.ReactNode;
};

export function BaseModal({
  title,
  onClose,
  maxWidth = 'max-w-lg',
  children,
  footer,
  headerExtra,
}: BaseModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-end md:items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className={`bg-surface border border-border rounded-t-xl md:rounded-lg w-full ${maxWidth} shadow-xl max-h-[90vh] overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 md:px-6 py-4 border-b border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <h2 className="text-base md:text-lg font-semibold text-text">{title}</h2>
            <button onClick={onClose} className="p-1 hover:bg-surface-hover rounded-lg md:hidden">
              <X className="w-5 h-5 text-text-muted" />
            </button>
          </div>
          {headerExtra}
        </div>

        {/* Body */}
        <div className="p-5 md:p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-140px)]">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-5 md:px-6 py-4 border-t border-border flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
