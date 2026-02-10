import { useMemo } from 'react';
import { type ReplyPreview } from '../api';
import { type DailyPoint } from '../components/dashboard/MiniLineChart';

export interface DerivedDashboardData {
  replyRate: number;
  meetingRate: number;
  activeConversations: number;
  daily: DailyPoint[];
  recentReplies: ReplyPreview[];
  outlookConnected: boolean;
  nextSends: any[];
}

export function useDerivedDashboardData(
  emailStats: any,
  scheduledEmails: any[] | undefined
): DerivedDashboardData {
  const replyRate = emailStats?.reply_rate ?? 0;
  const meetingRate = emailStats?.meeting_booking_rate ?? 0;
  const activeConversations = emailStats?.active_conversations ?? 0;
  const daily: DailyPoint[] = emailStats?.daily ?? [];
  const recentReplies: ReplyPreview[] = emailStats?.recent_replies ?? [];
  const outlookConnected = emailStats?.outlook_connected ?? false;

  const nextSends = useMemo(() => {
    const todayStr = new Date().toDateString();
    return (scheduledEmails || [])
      .filter((e: any) => e.scheduled_send_time && new Date(e.scheduled_send_time).toDateString() === todayStr)
      .slice(0, 3);
  }, [scheduledEmails]);

  return {
    replyRate,
    meetingRate,
    activeConversations,
    daily,
    recentReplies,
    outlookConnected,
    nextSends,
  };
}
