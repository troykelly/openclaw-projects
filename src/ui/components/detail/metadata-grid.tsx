import * as React from 'react';
import { useState } from 'react';
import { Calendar, Clock, User, AlertCircle, Pencil, Check, X } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import type { WorkItemStatus, WorkItemPriority } from './types';

function formatDate(date: Date | undefined): string {
  if (!date) return 'Not set';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatMinutes(minutes: number | undefined): string {
  if (!minutes) return 'Not set';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

interface MetadataFieldProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  editable?: boolean;
  onEdit?: (value: string) => void;
  editType?: 'text' | 'select' | 'date' | 'number';
  options?: Array<{ value: string; label: string }>;
}

function MetadataField({ icon, label, value, editable, onEdit, editType = 'text', options }: MetadataFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const handleSave = () => {
    onEdit?.(editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  return (
    <div className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/50">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {isEditing ? (
          <div className="mt-1 flex items-center gap-1">
            {editType === 'select' && options ? (
              <Select value={editValue} onValueChange={setEditValue}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : editType === 'date' ? (
              <Input type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-8 text-sm" />
            ) : (
              <Input
                type={editType === 'number' ? 'number' : 'text'}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="h-8 text-sm"
              />
            )}
            <Button variant="ghost" size="icon" className="size-6" onClick={handleSave}>
              <Check className="size-3" />
            </Button>
            <Button variant="ghost" size="icon" className="size-6" onClick={handleCancel}>
              <X className="size-3" />
            </Button>
          </div>
        ) : (
          <div className="group flex items-center gap-1">
            <p className="text-sm">{value}</p>
            {editable && onEdit && (
              <Button variant="ghost" size="icon" className="size-5 opacity-0 group-hover:opacity-100" onClick={() => setIsEditing(true)}>
                <Pencil className="size-3" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_OPTIONS: Array<{ value: WorkItemStatus; label: string }> = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS: Array<{ value: WorkItemPriority; label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export interface MetadataGridProps {
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assignee?: string;
  dueDate?: Date;
  startDate?: Date;
  estimateMinutes?: number;
  actualMinutes?: number;
  onStatusChange?: (status: WorkItemStatus) => void;
  onPriorityChange?: (priority: WorkItemPriority) => void;
  onAssigneeChange?: (assignee: string) => void;
  onDueDateChange?: (date: string) => void;
  onStartDateChange?: (date: string) => void;
  onEstimateChange?: (minutes: string) => void;
  onActualChange?: (minutes: string) => void;
  className?: string;
}

export function MetadataGrid({
  status,
  priority,
  assignee,
  dueDate,
  startDate,
  estimateMinutes,
  actualMinutes,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onDueDateChange,
  onStartDateChange,
  onEstimateChange,
  onActualChange,
  className,
}: MetadataGridProps) {
  const getPriorityLabel = (p: WorkItemPriority) => PRIORITY_OPTIONS.find((o) => o.value === p)?.label ?? p;
  const getStatusLabel = (s: WorkItemStatus) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;

  return (
    <div className={cn('grid gap-1 sm:grid-cols-2', className)}>
      <MetadataField
        icon={<AlertCircle className="size-4" />}
        label="Status"
        value={getStatusLabel(status)}
        editable={!!onStatusChange}
        onEdit={(v) => onStatusChange?.(v as WorkItemStatus)}
        editType="select"
        options={STATUS_OPTIONS}
      />
      <MetadataField
        icon={<AlertCircle className="size-4" />}
        label="Priority"
        value={getPriorityLabel(priority)}
        editable={!!onPriorityChange}
        onEdit={(v) => onPriorityChange?.(v as WorkItemPriority)}
        editType="select"
        options={PRIORITY_OPTIONS}
      />
      <MetadataField
        icon={<User className="size-4" />}
        label="Assignee"
        value={assignee || 'Unassigned'}
        editable={!!onAssigneeChange}
        onEdit={onAssigneeChange}
      />
      <MetadataField
        icon={<Calendar className="size-4" />}
        label="Due Date"
        value={formatDate(dueDate)}
        editable={!!onDueDateChange}
        onEdit={onDueDateChange}
        editType="date"
      />
      <MetadataField
        icon={<Calendar className="size-4" />}
        label="Start Date"
        value={formatDate(startDate)}
        editable={!!onStartDateChange}
        onEdit={onStartDateChange}
        editType="date"
      />
      <MetadataField
        icon={<Clock className="size-4" />}
        label="Estimate"
        value={formatMinutes(estimateMinutes)}
        editable={!!onEstimateChange}
        onEdit={onEstimateChange}
        editType="number"
      />
      <MetadataField
        icon={<Clock className="size-4" />}
        label="Actual"
        value={formatMinutes(actualMinutes)}
        editable={!!onActualChange}
        onEdit={onActualChange}
        editType="number"
      />
    </div>
  );
}
