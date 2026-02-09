/**
 * Toolbar button component for the editor.
 * Part of Epic #338, Issue #757
 */

import React from 'react';
import { Button } from '@/ui/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import type { ToolbarButtonProps } from '../types';

export function ToolbarButton({ icon, label, onClick, active, disabled }: ToolbarButtonProps): React.JSX.Element {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant={active ? 'secondary' : 'ghost'} size="sm" onClick={onClick} disabled={disabled} className="h-8 w-8 p-0">
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
