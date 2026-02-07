import { Loader2 } from 'lucide-react';

/**
 * Consistent loading spinner used across the app.
 * Two sizes: "sm" for inline/button spinners, "lg" for full-area placeholders.
 *
 * @example Page-level loading
 * <LoadingSpinner size="lg" />
 *
 * @example Inline button spinner
 * <LoadingSpinner size="sm" />
 */
export type LoadingSpinnerProps = {
  /** "sm" = 16px icon, "lg" = 32px border spinner centered in a py-20 container */
  size?: 'sm' | 'lg';
  /** Additional CSS classes */
  className?: string;
};

export function LoadingSpinner({ size = 'lg', className = '' }: LoadingSpinnerProps) {
  if (size === 'sm') {
    return <Loader2 className={`w-4 h-4 animate-spin ${className}`} />;
  }

  return (
    <div className={`flex items-center justify-center py-20 ${className}`}>
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
