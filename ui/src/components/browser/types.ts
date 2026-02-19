export type TabStatus = 'active' | 'idle' | 'running' | 'error' | 'blocked';

export type TabSortBy = 'recent' | 'domain' | 'status';
export type TabGroupBy = 'none' | 'domain';
export type TabViewMode = 'list' | 'grid';
export type WorkflowActionType = 'focus' | 'observe' | 'annotate' | 'validate' | 'synthesize' | 'refresh';

export type TabValidationSummary = {
  fitScore: number;
  status: 'pass' | 'fail' | 'unknown';
  checkedAt: number;
};

export type WorkbenchTab = {
  id: string;
  title: string;
  url: string;
  domain: string;
  faviconUrl: string | null;
  status: TabStatus;
  isActive: boolean;
  isPinned: boolean;
  lastUsedAt: number;
  lastUpdatedAt: number;
  lastError: string | null;
  hasAnnotations: boolean;
  validationSummary: TabValidationSummary | null;
  screenshotUrl: string | null;
};

