import type { ReactNode } from 'react';
import { PageHeader } from './PageHeader';

type WorkspacePageShellProps = {
  title: string;
  subtitle: string;
  preHeader?: ReactNode;
  preHeaderAffectsLayout?: boolean;
  preHeaderClassName?: string;
  headerInline?: ReactNode;
  desktopActions?: ReactNode;
  mobileActions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  hideHeader?: boolean;
  stickyHeader?: boolean;
};

export function WorkspacePageShell({
  title,
  subtitle,
  preHeader,
  preHeaderAffectsLayout = true,
  preHeaderClassName = '',
  headerInline,
  desktopActions,
  mobileActions,
  toolbar,
  children,
  contentClassName = '',
  hideHeader = false,
  stickyHeader = true,
}: WorkspacePageShellProps) {
  const shellTopClass = preHeader ? 'pt-0' : 'pt-3 md:pt-4';
  return (
    <div className="h-full flex flex-col">
      <div className="min-h-0 flex flex-col">
        <div className={stickyHeader ? 'sticky top-0 z-10' : ''}>
          <div className={`relative ${shellTopClass}`.trim()}>
            {preHeader ? (
              <div
                className={`${preHeaderAffectsLayout ? '' : 'absolute left-0 right-0 z-20'} ${preHeaderClassName}`.trim()}
              >
                {preHeader}
              </div>
            ) : null}
            {!hideHeader ? (
              <PageHeader
                title={title}
                subtitle={subtitle}
                desktopInline={headerInline}
                desktopActions={desktopActions}
                mobileActions={mobileActions}
              />
            ) : null}
            {toolbar ? <div className={hideHeader ? '' : 'mt-2'}>{toolbar}</div> : null}
          </div>
        </div>

        <div className={`flex-1 min-h-0 flex flex-col ${contentClassName}`.trim()}>
          {children}
        </div>
      </div>
    </div>
  );
}
