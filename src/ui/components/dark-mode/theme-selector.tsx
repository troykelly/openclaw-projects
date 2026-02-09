/**
 * Theme Selector component
 * Issue #414: Dark mode refinements
 */
import * as React from 'react';
import { Moon, Sun, Monitor, Smartphone } from 'lucide-react';
import { useTheme, type Theme } from './theme-provider';
import { cn } from '@/ui/lib/utils';

export interface ThemeSelectorProps {
  showOled?: boolean;
  className?: string;
}

interface ThemeOption {
  value: Theme;
  label: string;
  icon: React.ReactNode;
}

export function ThemeSelector({ showOled = false, className }: ThemeSelectorProps) {
  const { theme, setTheme } = useTheme();

  const options: ThemeOption[] = [
    { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
    { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
  ];

  if (showOled) {
    options.push({
      value: 'oled',
      label: 'OLED',
      icon: <Smartphone className="h-4 w-4" />,
    });
  }

  return (
    <div className={cn('flex flex-col gap-2', className)} role="radiogroup" aria-label="Theme selection">
      {options.map((option) => {
        const isSelected = theme === option.value;
        const inputId = `theme-${option.value}`;

        return (
          <label
            key={option.value}
            htmlFor={inputId}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
              isSelected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            <input
              type="radio"
              id={inputId}
              name="theme"
              value={option.value}
              checked={isSelected}
              onChange={() => setTheme(option.value)}
              className="sr-only"
              aria-label={option.label}
            />
            <span className="text-muted-foreground">{option.icon}</span>
            <span className="font-medium">{option.label}</span>
            {isSelected && (
              <span className="ml-auto text-primary">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
