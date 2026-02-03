/**
 * Types for the labels/tags system
 */

/**
 * A label for categorizing work items
 */
export interface Label {
  id: string;
  name: string;
  color: string;
  description?: string;
  normalizedName?: string;
  createdAt?: string;
}

/**
 * Data for creating a new label
 */
export interface CreateLabelData {
  name: string;
  color: string;
  description?: string;
}

/**
 * Data for updating a label
 */
export interface UpdateLabelData {
  name?: string;
  color?: string;
  description?: string;
}

/**
 * Props for LabelBadge component
 */
export interface LabelBadgeProps {
  label: Label;
  size?: 'sm' | 'md';
  onRemove?: (label: Label) => void;
  className?: string;
}

/**
 * Props for LabelPicker component
 */
export interface LabelPickerProps {
  labels: Label[];
  selectedLabels: Label[];
  onSelect: (label: Label) => void;
  onDeselect: (label: Label) => void;
  onCreate?: (name: string) => void;
  className?: string;
}

/**
 * Props for LabelManager component
 */
export interface LabelManagerProps {
  labels: Label[];
  onCreate: (data: CreateLabelData) => void;
  onUpdate: (id: string, data: UpdateLabelData) => void;
  onDelete: (id: string) => void;
  className?: string;
}

/**
 * Return type for useLabels hook
 */
export interface UseLabelsReturn {
  labels: Label[];
  loading: boolean;
  error: string | null;
  createLabel: (data: CreateLabelData) => Promise<Label>;
  updateLabel: (id: string, data: UpdateLabelData) => Promise<Label>;
  deleteLabel: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}
