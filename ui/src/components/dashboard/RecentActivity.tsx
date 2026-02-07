type ActivityLine = {
  time: string;
  text: string;
};

type RecentActivityProps = {
  lines: ActivityLine[];
};

export function RecentActivity({ lines }: RecentActivityProps) {
  const recent = lines.slice(-8).reverse();

  if (recent.length === 0) {
    return <p className="text-xs text-text-muted text-center py-4">No recent activity</p>;
  }

  return (
    <div className="space-y-2.5">
      {recent.map((line, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-text leading-snug">{line.text}</p>
            <p className="text-[10px] text-text-dim mt-0.5">{new Date(line.time).toLocaleTimeString()}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
