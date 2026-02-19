import { InlineConfirmRow } from './InlineConfirmRow';

interface ActionCardProps {
  summary: string;
  details?: string;
  onConfirm: () => void;
  onDeny: () => void;
}

export function ActionCard({ summary, details, onConfirm, onDeny }: ActionCardProps) {
  return (
    <InlineConfirmRow
      summary={summary || 'Confirm before running planned actions.'}
      details={details}
      onConfirm={onConfirm}
      onDeny={onDeny}
    />
  );
}
