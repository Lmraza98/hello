import type { SentEmail } from '../../../types/email';

export type DailyPoint = {
  date: string;
  sent: number;
  viewed: number;
  responded: number;
};

export type EntityAggregate = {
  key: string;
  label: string;
  sent: number;
  viewed: number;
  responded: number;
  replyRate: number;
  campaignsUsed: Set<number>;
  templatesUsed: Set<string>;
  dailyByDate: Map<string, { sent: number; viewed: number; responded: number }>;
};

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}pp`;
}

export function calculateReplyRate(points: Array<{ sent: number; responded: number }>): number | null {
  if (points.length === 0) return null;
  const sent = points.reduce((sum, point) => sum + point.sent, 0);
  if (sent === 0) return null;
  const responded = points.reduce((sum, point) => sum + point.responded, 0);
  return (responded / sent) * 100;
}

function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildDailyWindow(daily: DailyPoint[], windowDays: number): DailyPoint[] {
  const byDate = new Map<string, { sent: number; viewed: number; responded: number }>();
  daily.forEach((point) => {
    byDate.set(point.date, {
      sent: point.sent ?? 0,
      viewed: point.viewed ?? 0,
      responded: point.responded ?? 0,
    });
  });

  const today = new Date();
  const result: DailyPoint[] = [];

  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const key = toDayKey(day);
    const found = byDate.get(key);
    result.push({
      date: key,
      sent: found?.sent ?? 0,
      viewed: found?.viewed ?? 0,
      responded: found?.responded ?? 0,
    });
  }

  return result;
}

export function normalizeTemplateName(email: SentEmail): string {
  const candidate = (email.subject || email.rendered_subject || '').trim();
  return candidate || `Step ${email.step_number}`;
}

export function inLastDays(dateStr: string | null | undefined, days: number): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  cutoff.setHours(0, 0, 0, 0);
  return date >= cutoff;
}

export function aggregateEntities(
  emails: SentEmail[],
  mode: 'campaign' | 'template',
  days: number
): EntityAggregate[] {
  const grouped = new Map<string, EntityAggregate>();
  for (const email of emails) {
    if (!inLastDays(email.sent_at, days)) continue;
    const key =
      mode === 'campaign'
        ? String(email.campaign_id || 'unknown')
        : `${normalizeTemplateName(email)}::${email.step_number}`;
    const label =
      mode === 'campaign' ? email.campaign_name || `Campaign ${email.campaign_id}` : normalizeTemplateName(email);
    const existing = grouped.get(key) || {
      key,
      label,
      sent: 0,
      viewed: 0,
      responded: 0,
      replyRate: 0,
      campaignsUsed: new Set<number>(),
      templatesUsed: new Set<string>(),
      dailyByDate: new Map<string, { sent: number; viewed: number; responded: number }>(),
    };
    existing.sent += 1;
    existing.viewed += email.opened ? 1 : 0;
    existing.responded += email.replied ? 1 : 0;
    existing.campaignsUsed.add(email.campaign_id);
    existing.templatesUsed.add(normalizeTemplateName(email));
    const dayKey = email.sent_at?.slice(0, 10) || '';
    if (dayKey) {
      const point = existing.dailyByDate.get(dayKey) || { sent: 0, viewed: 0, responded: 0 };
      point.sent += 1;
      point.viewed += email.opened ? 1 : 0;
      point.responded += email.replied ? 1 : 0;
      existing.dailyByDate.set(dayKey, point);
    }
    grouped.set(key, existing);
  }
  const output = Array.from(grouped.values());
  output.forEach((item) => {
    item.replyRate = item.sent > 0 ? (item.responded / item.sent) * 100 : 0;
  });
  output.sort((a, b) => (b.replyRate !== a.replyRate ? b.replyRate - a.replyRate : b.sent - a.sent));
  return output;
}

export function buildDailyForEntity(dayWindow: DailyPoint[], aggregate: EntityAggregate | null): DailyPoint[] {
  if (!aggregate) return dayWindow;
  return dayWindow.map((day) => {
    const found = aggregate.dailyByDate.get(day.date);
    return {
      date: day.date,
      sent: found?.sent || 0,
      viewed: found?.viewed || 0,
      responded: found?.responded || 0,
    };
  });
}
