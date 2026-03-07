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
    <section className="py-1">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 pb-1.5">
        <p className="mr-1 text-[11px] font-medium uppercase tracking-wide text-text-dim">System</p>
        {items.map((item) => {
          const Icon = iconMap[item.key];
          return (
            <span
              key={item.key}
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${toneMap[item.tone]}`}
            >
              <Icon className="h-3 w-3" />
              <span className="font-medium">{labelMap[item.key]}</span>
              <span>{item.state}</span>
            </span>
          );
        })}
      </div>
    </section>
  );
}

export type { StatusItem, Tone, StatusKey };
