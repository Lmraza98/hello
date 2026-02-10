import {
  Clock,
  Mail,
  MessageCircle,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { AlertState } from '../../types/chat';

export interface SectionBarProps {
  onSectionClick: (section: string) => void;
  badges: {
    conversations?: number;
    scheduled?: number;
    contacts?: number;
    emailDays?: number;
  };
  alerts?: AlertState;
}

const sections = [
  { key: 'overview', icon: TrendingUp, label: 'Overview', alertKey: 'overview' as const },
  { key: 'conversations', icon: MessageCircle, label: 'Conversations', badgeKey: 'conversations' as const, alertKey: 'conversations' as const },
  { key: 'scheduled', icon: Clock, label: 'Sends', badgeKey: 'scheduled' as const, alertKey: 'scheduled' as const },
  { key: 'performance', icon: Mail, label: 'Performance', badgeKey: 'emailDays' as const, alertKey: 'performance' as const },
  { key: 'contacts', icon: Users, label: 'Contacts', badgeKey: 'contacts' as const, alertKey: 'contacts' as const },
];

export function SectionBar({ onSectionClick, badges, alerts }: SectionBarProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-t border-border overflow-x-auto scrollbar-hide">
      {sections.map((s) => {
        const badge = s.badgeKey ? badges?.[s.badgeKey] : undefined;
        const alert = alerts?.[s.alertKey as keyof AlertState];
        const isNew = alert
          ? 'isNew' in alert ? alert.isNew : alert.hasUpdate
          : false;
        const alertCount = alert && 'count' in alert ? alert.count : undefined;
        const displayCount = alertCount ?? badge;

        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSectionClick(s.key)}
            className={`relative flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-full transition-all whitespace-nowrap shrink-0 ${
              isNew
                ? 'bg-red-50 border border-red-200 text-red-700 ring-1 ring-red-100'
                : 'bg-surface border border-border text-text-muted hover:bg-surface-hover hover:text-text'
            }`}
          >
            <s.icon className={`w-3.5 h-3.5 ${isNew ? 'text-red-500' : ''}`} />
            {s.label}
            {displayCount != null && displayCount > 0 && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                isNew
                  ? 'bg-red-500 text-white'
                  : 'bg-accent/10 text-accent'
              }`}>
                {displayCount}
              </span>
            )}
            {/* Pulse dot for new alerts */}
            {isNew && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            )}
          </button>
        );
      })}
    </div>
  );
}
