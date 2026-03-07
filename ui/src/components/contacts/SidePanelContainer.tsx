import { useEffect, useState, type ReactNode, forwardRef } from 'react';

type SidePanelContainerProps = {
  children: ReactNode;
  ariaLabel?: string;
};

export const SidePanelContainer = forwardRef<HTMLDivElement, SidePanelContainerProps>(function SidePanelContainer(
  { children, ariaLabel = 'Details panel' },
  ref
) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-label={ariaLabel}
      className={`w-[420px] lg:w-[460px] h-full shrink-0 border-l border-border bg-surface min-h-0 overflow-hidden flex flex-col transition-all duration-200 ease-out ${
        entered ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
      }`}
    >
      {children}
    </aside>
  );
});
