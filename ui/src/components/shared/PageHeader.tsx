/**
 * Standard page header with title, subtitle, and responsive action buttons.
 * Desktop actions render as a horizontal row; mobile actions render as
 * compact icon buttons. Both slots are hidden on the opposite breakpoint.
 *
 * @example
 * <PageHeader
 *   title="Companies"
 *   subtitle={`${count} companies`}
 *   desktopActions={<><button>Import CSV</button><button>Add</button></>}
 *   mobileActions={<><IconButton icon={Upload} /><IconButton icon={Plus} /></>}
 * />
 */
export type PageHeaderProps = {
  /** Page title (e.g. "Companies", "Contacts") */
  title: string;
  /** Subtitle text (e.g. counts, filters summary) */
  subtitle: string;
  /** Action buttons visible only on desktop (md+) */
  desktopActions?: React.ReactNode;
  /** Compact action buttons visible only on mobile (<md) */
  mobileActions?: React.ReactNode;
};

export function PageHeader({
  title,
  subtitle,
  desktopActions,
  mobileActions,
}: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-2 md:mb-4 gap-2">
      <div className="min-w-0">
        <div className="md:flex md:items-baseline md:gap-2">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-text">{title}</h1>
          <p className="text-[11px] md:text-xs text-text-muted">{subtitle}</p>
        </div>
      </div>
      {desktopActions ? (
        <div className="hidden md:flex items-center gap-1.5">{desktopActions}</div>
      ) : null}
      {mobileActions ? (
        <div className="flex md:hidden items-center gap-1.5 shrink-0">{mobileActions}</div>
      ) : null}
    </div>
  );
}
