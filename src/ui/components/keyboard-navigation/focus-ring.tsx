/**
 * Focus Ring component
 * Issue #410: Implement keyboard navigation throughout
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface FocusRingProps {
  children: React.ReactNode;
  className?: string;
}

export function FocusRing({ children, className }: FocusRingProps) {
  const [isFocusVisible, setIsFocusVisible] = React.useState(false);
  const [hadKeyboardEvent, setHadKeyboardEvent] = React.useState(false);

  React.useEffect(() => {
    const handleKeyDown = () => {
      setHadKeyboardEvent(true);
    };

    const handleMouseDown = () => {
      setHadKeyboardEvent(false);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleMouseDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, []);

  const handleFocus = () => {
    if (hadKeyboardEvent) {
      setIsFocusVisible(true);
    }
  };

  const handleBlur = () => {
    setIsFocusVisible(false);
  };

  return (
    <div
      data-focus-visible={isFocusVisible}
      className={cn(
        'relative inline-flex',
        isFocusVisible &&
          'ring-2 ring-ring ring-offset-2 ring-offset-background rounded',
        className
      )}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {children}
    </div>
  );
}
