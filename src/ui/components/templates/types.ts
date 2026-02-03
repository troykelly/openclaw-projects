/**
 * Types for template system
 */

/**
 * Structure of a work item within a template
 */
export interface TemplateStructure {
  kind: 'project' | 'initiative' | 'epic' | 'issue' | 'task';
  title: string;
  description?: string;
  children?: TemplateStructure[];
  todos?: string[];
}

/**
 * A work item template
 */
export interface WorkItemTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  structure: TemplateStructure;
  createdAt: string;
  isBuiltIn?: boolean;
}

/**
 * Template categories
 */
export type TemplateCategory =
  | 'sprint'
  | 'feature'
  | 'bugfix'
  | 'project'
  | 'custom';

/**
 * Props for TemplateSelector component
 */
export interface TemplateSelectorProps {
  open: boolean;
  onSelect: (template: WorkItemTemplate) => void;
  onCancel: () => void;
  filterCategory?: TemplateCategory;
}

/**
 * Props for SaveTemplateDialog component
 */
export interface SaveTemplateDialogProps {
  open: boolean;
  item: {
    id: string;
    title: string;
    kind: string;
    children?: Array<{ id: string; title: string; kind: string }>;
  };
  onSave: (template: Omit<WorkItemTemplate, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}

/**
 * Return type for useTemplates hook
 */
export interface UseTemplatesReturn {
  templates: WorkItemTemplate[];
  saveTemplate: (template: Omit<WorkItemTemplate, 'id' | 'createdAt'>) => void;
  deleteTemplate: (id: string) => void;
  getTemplatesByCategory: (category: TemplateCategory) => WorkItemTemplate[];
}
