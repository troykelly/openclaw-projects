/**
 * Theme Toggle button
 * Issue #414: Dark mode refinements
 */
import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { useTheme } from './theme-provider';
import { cn } from '@/ui/lib/utils';

export interface ThemeToggleProps {
  className?: string;
  size?: 'sm' | 'default' | 'lg';
}

export function ThemeToggle({ className, size = 'default' }: ThemeToggleProps) {
  const { isDark, toggleTheme } = useTheme();

  const iconSize = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';

  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} className={cn(className)} aria-label="Toggle theme">
      {isDark ? <Sun className={iconSize} data-testid="sun-icon" /> : <Moon className={iconSize} data-testid="moon-icon" />}
    </Button>
  );
}
