import type { EmailConfig } from '../../types/email';

type SettingsPanelProps = {
  emailConfig: EmailConfig;
  onUpdateConfig: (data: Partial<EmailConfig>) => void;
};

export function SettingsPanel({ emailConfig, onUpdateConfig }: SettingsPanelProps) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4 md:p-6 mb-4 md:mb-6">
      <h3 className="text-base md:text-lg font-semibold text-text mb-3 md:mb-4">Email System Settings</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        <div>
          <label className="block text-sm font-medium text-text mb-1">Daily Send Cap</label>
          <input
            type="number"
            defaultValue={emailConfig.daily_send_cap}
            onBlur={e => onUpdateConfig({ daily_send_cap: e.target.value })}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Send Window Start</label>
          <input
            type="time"
            defaultValue={emailConfig.send_window_start}
            onBlur={e => onUpdateConfig({ send_window_start: e.target.value })}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Send Window End</label>
          <input
            type="time"
            defaultValue={emailConfig.send_window_end}
            onBlur={e => onUpdateConfig({ send_window_end: e.target.value })}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Min Minutes Between Sends</label>
          <input
            type="number"
            defaultValue={emailConfig.min_minutes_between_sends}
            onBlur={e => onUpdateConfig({ min_minutes_between_sends: e.target.value })}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Tracking Poll Interval (min)</label>
          <input
            type="number"
            defaultValue={emailConfig.tracking_poll_interval_minutes}
            onBlur={e => onUpdateConfig({ tracking_poll_interval_minutes: e.target.value })}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Tracking Lookback (days)</label>
          <input
            type="number"
            defaultValue={emailConfig.tracking_lookback_days}
            onBlur={e => onUpdateConfig({ tracking_lookback_days: e.target.value })}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
          />
        </div>
      </div>
    </div>
  );
}
