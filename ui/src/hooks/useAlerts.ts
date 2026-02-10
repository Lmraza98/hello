import { useState, useMemo, useCallback } from 'react';
import type { AlertState, BackgroundTask } from '../types/chat';

interface UseAlertsInput {
  recentReplies: any[];
  nextSends: any[];
  todaysContacts: any[];
  daily: any[];
  backgroundTasks: BackgroundTask[];
}

/**
 * Tracks "unseen" counts per section.
 * When user clicks a section pill, that section's alert clears.
 * When new data arrives (via polling), alerts increment.
 */
export function useAlerts(data: UseAlertsInput) {
  const [seen, setSeen] = useState<Record<string, number>>({
    conversations: 0,
    scheduled: 0,
    contacts: 0,
    companies: 0,
  });

  const hasRunningTask = data.backgroundTasks.some((t) => t.status === 'running');
  const runningTaskTypes = data.backgroundTasks
    .filter((t) => t.status === 'running')
    .map((t) => t.type);

  const alerts = useMemo<AlertState>(() => {
    const convoCount = data.recentReplies.length;
    const sendCount = data.nextSends.length;
    const contactCount = data.todaysContacts.length;

    return {
      conversations: {
        count: convoCount,
        isNew: convoCount > (seen.conversations || 0),
      },
      scheduled: {
        count: sendCount,
        isNew: sendCount > (seen.scheduled || 0),
      },
      contacts: {
        count: contactCount,
        isNew: contactCount > (seen.contacts || 0) ||
          runningTaskTypes.includes('lead_scraping'),
      },
      companies: {
        count: 0,
        isNew: runningTaskTypes.includes('company_search'),
      },
      performance: { hasUpdate: false },
      overview: { hasUpdate: false },
    };
  }, [data, seen, runningTaskTypes]);

  const markSeen = useCallback((section: string) => {
    setSeen((prev) => ({
      ...prev,
      [section]: (() => {
        switch (section) {
          case 'conversations': return data.recentReplies.length;
          case 'scheduled': return data.nextSends.length;
          case 'contacts': return data.todaysContacts.length;
          default: return prev[section] || 0;
        }
      })(),
    }));
  }, [data]);

  return { alerts, markSeen, hasRunningTask };
}
