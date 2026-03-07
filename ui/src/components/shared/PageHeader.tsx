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
  /** Optional desktop-only inline content between title and actions */
  desktopInline?: React.ReactNode;
  /** Action buttons visible only on desktop (md+) */
  desktopActions?: React.ReactNode;
  /** Compact action buttons visible only on mobile (<md) */
  mobileActions?: React.ReactNode;
};

export function PageHeader({
  title,
  subtitle,
  desktopInline,
  desktopActions,
  mobileActions,
}: PageHeaderProps) {
  return (
    <div className="mb-2 md:mb-4">
      <div className="flex items-start gap-2 md:gap-3 min-w-0">
        <div className="min-w-0 shrink">
          <div className="md:flex md:items-baseline md:gap-2">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-text whitespace-nowrap">{title}</h1>
            <p className="text-[11px] md:text-xs text-text-muted whitespace-nowrap">{subtitle}</p>
          </div>
        </div>
        {desktopInline ? (
          <div className="hidden lg:flex min-w-0 flex-1 items-center overflow-hidden">
            {desktopInline}
          </div>
        ) : (
          <div className="hidden lg:block min-w-0 flex-1" />
        )}
        {desktopActions ? (
          <div className="hidden md:flex items-center gap-1.5 shrink-0">{desktopActions}</div>
        ) : null}
        {mobileActions ? (
          <div className="flex md:hidden items-center gap-1.5 shrink-0 ml-auto">{mobileActions}</div>
        ) : null}
      </div>
    </div>
  );
}
