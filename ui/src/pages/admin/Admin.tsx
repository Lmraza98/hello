import { FlaskConical, Shield, ReceiptText, ScrollText, TestTube2 } from 'lucide-react';

const tabBase =
  'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors';
const tabInactive = 'border-border text-text-muted hover:bg-surface-hover';
const tabActive = 'border-border bg-surface-hover/60 text-text';

export default function Admin({
  tab,
  onTabChange,
  logsContent,
  costsContent,
  finetuneContent,
  testsContent,
}: {
  tab: 'logs' | 'costs' | 'finetune' | 'tests';
  onTabChange: (t: 'logs' | 'costs' | 'finetune' | 'tests') => void;
  logsContent?: React.ReactNode;
  costsContent?: React.ReactNode;
  finetuneContent?: React.ReactNode;
  testsContent?: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 z-10 bg-bg pb-3 md:pb-6">
        <div className="pt-3 px-3 md:pt-4 md:px-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-text-muted" />
                <h1 className="text-xl md:text-2xl font-semibold text-text">Admin</h1>
              </div>
              <p className="text-sm text-text-muted mt-1">Tests, logs, and cost monitoring.</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onTabChange('tests')}
                className={`${tabBase} ${tab === 'tests' ? tabActive : tabInactive}`}
              >
                <TestTube2 className="w-4 h-4" />
                Tests
              </button>

              <button
                type="button"
                onClick={() => onTabChange('logs')}
                className={`${tabBase} ${tab === 'logs' ? tabActive : tabInactive}`}
              >
                <ScrollText className="w-4 h-4" />
                Logs
              </button>

              <button
                type="button"
                onClick={() => onTabChange('costs')}
                className={`${tabBase} ${tab === 'costs' ? tabActive : tabInactive}`}
              >
                <ReceiptText className="w-4 h-4" />
                Costs
              </button>
              <span className="mx-1 h-5 w-px bg-border" />
              <button
                type="button"
                onClick={() => onTabChange('finetune')}
                className={`${tabBase} ${tab === 'finetune' ? tabActive : tabInactive} text-xs`}
                title="Advanced tooling for failure labeling and SFT dataset export"
              >
                <FlaskConical className="w-4 h-4" />
                Advanced: Fine-tune
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-3 pb-3 md:px-4 md:pb-4">
        {tab === 'logs' ? (
          logsContent ?? (
            <div className="bg-surface border border-border rounded-lg p-4 text-sm text-text-muted">
              Logs page goes here.
            </div>
          )
        ) : tab === 'costs' ? (
          costsContent ?? (
            <div className="bg-surface border border-border rounded-lg p-4 text-sm text-text-muted">
              Costs page goes here.
            </div>
          )
        ) : tab === 'finetune' ? (
          finetuneContent ?? (
            <div className="bg-surface border border-border rounded-lg p-4 text-sm text-text-muted">
              Fine-tune page goes here.
            </div>
          )
        ) : (
          testsContent ?? (
            <div className="bg-surface border border-border rounded-lg p-4 text-sm text-text-muted">
              Tests page goes here.
            </div>
          )
        )}
      </div>
    </div>
  );
}
