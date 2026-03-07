import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type HeaderActionVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type HeaderActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: HeaderActionVariant;
  icon?: ReactNode;
  compact?: boolean;
};

const VARIANT_CLASS: Record<HeaderActionVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-accent',
  secondary: 'border border-border text-text-muted hover:bg-surface-hover bg-surface',
  danger: 'border border-red-300 text-red-700 hover:bg-red-50 bg-white',
  ghost: 'border border-transparent text-text-muted hover:bg-surface-hover bg-transparent',
};

export const HeaderActionButton = forwardRef<HTMLButtonElement, HeaderActionButtonProps>(function HeaderActionButton(
  {
    variant = 'secondary',
    icon,
    compact = false,
    className = '',
    children,
    type = 'button',
    ...props
  },
  ref
) {
  const sizeClass = compact
    ? 'h-8 min-w-8 px-2 text-[12px]'
    : 'h-8 px-3 text-xs';
  const primaryWidthClass = !compact && variant === 'primary' ? 'min-w-[9rem]' : '';
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium leading-none transition-colors ${sizeClass} ${primaryWidthClass} ${VARIANT_CLASS[variant]} ${className}`.trim()}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});
