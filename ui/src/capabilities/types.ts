export interface ActionCapability {
  id: string;
  aliases?: string[];
  label: string;
  description: string;
  params: ActionParamSchema[];
  conditions?: ConditionSchema[];
  destructive?: boolean;
  category: 'navigation' | 'mutation' | 'filter' | 'display' | 'workflow';
}

export interface ActionParamSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]';
  required: boolean;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface ConditionSchema {
  type: 'selection_required' | 'min_selection' | 'permission' | 'state';
  value?: unknown;
  description: string;
}

export interface FilterCapability {
  id: string;
  label: string;
  type: 'select' | 'multi_select' | 'search' | 'date_range' | 'boolean';
  options?: { value: string; label: string }[];
  description: string;
}

export interface DisplayCapability {
  id: string;
  type: 'table' | 'chart' | 'card_grid' | 'detail_panel';
  description: string;
  columns?: string[];
  expandable?: boolean;
  selectable?: boolean;
}

export interface PageCapability {
  pageId: string;
  route: string;
  title: string;
  description: string;
  actions: ActionCapability[];
  filters: FilterCapability[];
  displays?: DisplayCapability[];
}
