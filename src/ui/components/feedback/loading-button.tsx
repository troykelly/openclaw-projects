import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button, type ButtonProps } from '@/ui/components/ui/button';

export interface LoadingButtonProps extends ButtonProps {
  /** Whether the button is in a loading state */
  loading?: boolean;
  /** Text to show while loading (defaults to children) */
  loadingText?: string;
  /** Position of the spinner relative to text */
  spinnerPosition?: 'left' | 'right';
}

export function LoadingButton({ loading = false, loadingText, spinnerPosition = 'left', children, disabled, className, ...props }: LoadingButtonProps) {
  const spinner = <Loader2 className="size-4 animate-spin" />;

  return (
    <Button disabled={disabled || loading} className={cn(loading && 'cursor-wait', className)} {...props}>
      {loading ? (
        <>
          {spinnerPosition === 'left' && spinner}
          <span className={cn(spinnerPosition === 'left' ? 'ml-2' : 'mr-2')}>{loadingText ?? children}</span>
          {spinnerPosition === 'right' && spinner}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
