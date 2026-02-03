/**
 * Types for inline edit components
 */

export interface InlineEditProps {
  /** Current value */
  value: string;
  /** Called when value is saved */
  onSave: (value: string) => void | Promise<void>;
  /** Called when editing is cancelled */
  onCancel?: () => void;
  /** Validate the value before saving. Returns true if valid. */
  validate?: (value: string) => boolean;
  /** Auto-save when input loses focus */
  saveOnBlur?: boolean;
  /** Select all text when entering edit mode */
  selectOnFocus?: boolean;
  /** Placeholder text for empty value */
  placeholder?: string;
  /** Custom className */
  className?: string;
  /** Disable editing */
  disabled?: boolean;
}

export interface InlineEditableTextProps extends Omit<InlineEditProps, 'onCancel'> {
  /** Use multiline textarea instead of input */
  multiline?: boolean;
  /** Trigger edit mode on double-click instead of single-click */
  doubleClick?: boolean;
  /** Custom edit mode className */
  editClassName?: string;
}

export interface InlineEditState {
  isEditing: boolean;
  editValue: string;
  isSaving: boolean;
  error?: string;
}
