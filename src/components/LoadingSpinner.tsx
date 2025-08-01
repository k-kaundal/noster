import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div
        className={cn(
          'animate-spin rounded-full border-2 border-muted border-t-primary',
          sizeClasses[size]
        )}
      />
    </div>
  );
}

export function PulsingDots({ className }: { className?: string }) {
  return (
    <div className={cn('flex space-x-1', className)}>
      <div className="h-2 w-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
      <div className="h-2 w-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
      <div className="h-2 w-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
    </div>
  );
}