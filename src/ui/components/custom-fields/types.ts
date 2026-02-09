/**
 * Types for custom fields system
 */

/**
 * Available custom field types
 */
export type CustomFieldType = 'text' | 'longtext' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox' | 'url' | 'user';

/**
 * Validation rules for custom fields
 */
export interface CustomFieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  patternMessage?: string;
}

/**
 * Definition of a custom field
 */
export interface CustomFieldDefinition {
  id: string;
  projectId: string;
  name: string;
  type: CustomFieldType;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
  validation?: CustomFieldValidation;
  order: number;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Value of a custom field for a specific work item
 */
export interface CustomFieldValue {
  fieldId: string;
  value: unknown;
}

/**
 * Data for creating a custom field
 */
export interface CreateCustomFieldData {
  name: string;
  type: CustomFieldType;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
  validation?: CustomFieldValidation;
}

/**
 * Data for updating a custom field
 */
export interface UpdateCustomFieldData {
  name?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
  validation?: CustomFieldValidation;
  archived?: boolean;
}

/**
 * Props for CustomFieldInput component
 */
export interface CustomFieldInputProps {
  field: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  error?: string;
}

/**
 * Props for CustomFieldList component
 */
export interface CustomFieldListProps {
  fields: CustomFieldDefinition[];
  values: CustomFieldValue[];
  onChange: (fieldId: string, value: unknown) => void;
  readOnly?: boolean;
  className?: string;
}

/**
 * Props for CustomFieldManager component
 */
export interface CustomFieldManagerProps {
  projectId: string;
  fields: CustomFieldDefinition[];
  onCreate: (data: CreateCustomFieldData) => void;
  onUpdate: (id: string, data: UpdateCustomFieldData) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  className?: string;
}

/**
 * Type labels for display
 */
export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  longtext: 'Long Text',
  number: 'Number',
  date: 'Date',
  select: 'Select',
  multiselect: 'Multi-Select',
  checkbox: 'Checkbox',
  url: 'URL',
  user: 'User',
};
