import { BrainCircuit, Linkedin, Mail, ScanSearch } from 'lucide-react';

type Tone = 'good' | 'warn' | 'bad' | 'unknown';
type StatusKey = 'ai' | 'linkedin' | 'smtp' | 'scraper';

type StatusItem = {
  key: StatusKey;
  state: string;
  tone: Tone;
};

type SystemStatusStripProps = {
  items: StatusItem[];
};

const iconMap = {
  ai: BrainCircuit,
  linkedin: Linkedin,
  smtp: Mail,
  scraper: ScanSearch,
} as const;

const labelMap = {
  ai: 'AI',
  linkedin: 'LinkedIn',
  smtp: 'SMTP',
  scraper: 'Scraper',
} as const;

const toneMap: Record<Tone, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  bad: 'border-red-200 bg-red-50 text-red-700',
  unknown: 'border-border bg-surface text-text-muted',
};

export function SystemStatusStrip({ items }: SystemStatusStripProps) {
  return (
    <section>
      <div className="flex flex-wrap items-center gap-px border border-border bg-border">
        <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-dim">System</p>
        <div className="flex flex-1 flex-wrap gap-px bg-border">
          {items.map((item) => {
            const Icon = iconMap[item.key];
            return (
              <span
                key={item.key}
                className={`inline-flex items-center gap-1 bg-surface px-2 py-1.5 text-[10px] ${toneMap[item.tone]}`}
              >
                <Icon className="h-3 w-3" />
                <span className="font-medium">{labelMap[item.key]}</span>
                <span>{item.state}</span>
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export type { StatusItem, Tone, StatusKey };
