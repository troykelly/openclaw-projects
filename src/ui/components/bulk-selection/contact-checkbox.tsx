/**
 * Checkbox for contact selection
 * Issue #397: Implement bulk contact operations
 */
import * as React from 'react';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { cn } from '@/ui/lib/utils';

export interface ContactCheckboxProps {
  contact_id: string;
  isSelected: boolean;
  onToggle: (id: string) => void;
  className?: string;
}

export function ContactCheckbox({ contact_id, isSelected, onToggle, className }: ContactCheckboxProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleChange = () => {
    onToggle(contact_id);
  };

  return (
    <div className={cn('flex items-center', className)} onClick={handleClick}>
      <Checkbox checked={isSelected} onCheckedChange={handleChange} aria-label={`Select contact`} />
    </div>
  );
}
