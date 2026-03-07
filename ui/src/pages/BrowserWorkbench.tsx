
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, type ColumnDef, useReactTable } from '@tanstack/react-table';
import { Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { api, type BrowserAnnotationBox, type BrowserTab, type BrowserWorkflowTask } from '../api';
import { getPageCapability } from '../capabilities/catalog';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { WorkflowDrawer } from '../components/browser/WorkflowDrawer';
import type { TabValidationSummary, WorkbenchTab, WorkflowActionType } from '../components/browser/types';
import { EmailTabs } from '../components/email/EmailTabs';
import { BROWSER_WORKFLOW_COMMAND_EVENT, isBrowserWorkflowCommand } from '../components/browser/workbenchBridge';
import { PageSearchInput } from '../components/shared/PageSearchInput';
import { SidePanelContainer } from '../components/contacts/SidePanelContainer';
import { BottomDrawerContainer } from '../components/contacts/BottomDrawerContainer';
import { usePageContext } from '../contexts/PageContextProvider';
import { useWorkspaceLayout } from '../components/shell/workspaceLayout';
import { useIsMobile } from '../hooks/useIsMobile';

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function resolveWorkflowTaskTabId(task: BrowserWorkflowTask): string | undefined {
  const diagnostics = task.diagnostics || {};
  const result = task.result || {};
  const diagnosticsTabId = typeof diagnostics.tab_id === 'string' ? diagnostics.tab_id.trim() : '';
  const resultTabId = typeof result.tab_id === 'string' ? result.tab_id.trim() : '';
  return diagnosticsTabId || resultTabId || undefined;
}

function browserTaskLabel(task: BrowserWorkflowTask): string {
  const diagnostics = task.diagnostics || {};
  const candidates = [
    typeof diagnostics.goal === 'string' ? diagnostics.goal : '',
    typeof diagnostics.query === 'string' ? diagnostics.query : '',
    typeof diagnostics.task === 'string' ? diagnostics.task : '',
    typeof diagnostics.operation === 'string' ? diagnostics.operation : '',
    typeof task.stage === 'string' ? task.stage : '',
  ];
  const label = candidates.map((value) => value.trim()).find(Boolean) || task.task_id;
  return label.length > 28 ? `${label.slice(0, 25).trimEnd()}...` : label;
}

type BrowserTaskTab = {
  id: string;
  label: string;
  status: string;
  stage: string;
  tabId?: string;
  count?: number;
};

type BrowserFlowSelection = BrowserTaskTab & {
  tabsOwned: string[];
};

function resolveTabOrder(tab: BrowserTab, fallbackIndex: number): number {
  const index = typeof tab.index === 'number' && Number.isFinite(tab.index) ? tab.index : fallbackIndex;
  return index;
}

function browserFlowLabel(tab: BrowserTab | undefined, tasks: BrowserWorkflowTask[]): string {
  const title = String(tab?.title || '').trim();
  if (title) {
    const normalized = title
      .replace(/\s*[-|]\s*linkedin.*$/i, '')
      .replace(/\s*[-|]\s*google search.*$/i, '')
      .trim();
    if (normalized) return normalized.length > 28 ? `${normalized.slice(0, 25).trimEnd()}...` : normalized;
  }
  const meaningfulTask = tasks.find((task) => {
    const operation = String(task.diagnostics?.operation || '').toLowerCase();
    return !['browser_snapshot', 'browser_find_ref', 'browser_wait', 'browser_act', 'browser_screenshot'].includes(operation);
  }) || tasks[0];
  return browserTaskLabel(meaningfulTask);
}

function browserWorkbenchTabLabel(tab: WorkbenchTab): string {
  const title = String(tab.title || '').trim();
  if (title) {
    const normalized = title
      .replace(/\s*[-|]\s*linkedin.*$/i, '')
      .replace(/\s*[-|]\s*google search.*$/i, '')
      .trim();
    if (normalized) return normalized.length > 24 ? `${normalized.slice(0, 21).trimEnd()}...` : normalized;
  }
  const domain = String(tab.domain || '').trim();
  if (domain && domain !== 'unknown') return domain;
  return tab.id;
}

function workbenchStatusPillClass(status: WorkbenchTab['status']): string {
  if (status === 'error') return 'bg-red-100 text-red-700';
  if (status === 'running') return 'bg-blue-100 text-blue-700';
  if (status === 'active') return 'bg-green-100 text-green-700';
  if (status === 'blocked') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

function formatWorkbenchTime(ts?: number | null): string {
  if (!ts || !Number.isFinite(ts)) return 'n/a';
  return new Date(ts).toLocaleString();
}

function isHelperBrowserOperation(task: BrowserWorkflowTask): boolean {
  const operation = String(task.diagnostics?.operation || '').toLowerCase();
  return ['browser_snapshot', 'browser_find_ref', 'browser_wait', 'browser_act', 'browser_screenshot'].includes(operation);
}

type CandidateSeed = {
  key: string;
  title: string;
  href_contains: string[];
  label_contains_any: string[];
  exclude_label_contains_any: string[];
  role_allowlist: string[];
  must_be_within_roles: string[];
  exclude_within_roles: string[];
  container_hint_contains: string[];
  exclude_container_hint_contains: string[];
  score: number;
};

type WizardStep = 1 | 2 | 3 | 4;
type CollectionTarget = 'posts' | 'people' | 'products' | 'articles';

const TARGET_PRESETS: Record<CollectionTarget, { label: string; pattern: string; helper: string }> = {
  posts: { label: 'Posts', pattern: '/comments/', helper: 'Collect forum and social posts.' },
  people: { label: 'People', pattern: '/in/', helper: 'Collect profile-style people records.' },
  products: { label: 'Products', pattern: '/product/', helper: 'Collect product pages and listings.' },
  articles: { label: 'Articles', pattern: '/article/', helper: 'Collect article and blog links.' },
};

function tokenizeLabel(value: string): string[] {
  const clean = (value || '').toLowerCase();
  const parts = clean.split(/[^a-z0-9]+/).filter(Boolean);
  return parts.filter((tok) => tok.length >= 3 && !/^\d+$/.test(tok)).slice(0, 6);
}

function extractCandidateSeeds(observation: Record<string, unknown> | undefined): CandidateSeed[] {
  if (!observation || typeof observation !== 'object') return [];
  const dom = (observation.dom as Record<string, unknown> | undefined) || {};
  const roleRefs = Array.isArray(dom.role_refs) ? (dom.role_refs as Array<Record<string, unknown>>) : [];
  const semanticNodes = Array.isArray(dom.semantic_nodes) ? (dom.semantic_nodes as Array<Record<string, unknown>>) : [];

  const rows = [...roleRefs, ...semanticNodes];
  const hrefs: string[] = [];
  const labelCounts = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  for (const row of roleRefs) {
    const href = typeof row.href === 'string' ? row.href.trim() : '';
    if (href) hrefs.push(href);
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    for (const tok of tokenizeLabel(label)) labelCounts.set(tok, (labelCounts.get(tok) || 0) + 1);
    const role = typeof row.role === 'string' ? row.role.trim().toLowerCase() : '';
    if (role) roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }
  for (const row of semanticNodes) {
    const href = typeof row.href === 'string' ? row.href.trim() : '';
    if (href) hrefs.push(href);
    const label = typeof row.text === 'string' ? row.text.trim() : '';
    for (const tok of tokenizeLabel(label)) labelCounts.set(tok, (labelCounts.get(tok) || 0) + 1);
    const role = typeof row.role === 'string' ? row.role.trim().toLowerCase() : '';
    if (role) roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }

  const score = new Map<string, number>();
  for (const href of hrefs) {
    try {
      const parsed = new URL(href, 'https://placeholder.local');
      const path = (parsed.pathname || '/').trim();
      if (path && path !== '/') {
        const parts = path.split('/').filter(Boolean);
        if (parts[0]) {
          const token = `/${parts[0]}/`;
          score.set(token, (score.get(token) || 0) + 2);
        }
        if (parts.length >= 2) {
          const token = `/${parts[0]}/${parts[1]}/`;
          score.set(token, (score.get(token) || 0) + 3);
        }
      }
      if (parsed.hostname && parsed.hostname !== 'placeholder.local') {
        score.set(parsed.hostname, (score.get(parsed.hostname) || 0) + 1);
      }
    } catch {
      // ignore malformed hrefs
    }
  }

  const topPatterns = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const topLabels = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tok]) => tok);
  const topRoles = [...roleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([role]) => role);

  const seeds: CandidateSeed[] = topPatterns.map(([token, sc], idx) => ({
    key: `seed-${idx}-${token}`,
    title: `Pattern ${token}`,
    href_contains: [token],
    label_contains_any: topLabels,
    exclude_label_contains_any: [],
    role_allowlist: topRoles,
    must_be_within_roles: [],
    exclude_within_roles: [],
    container_hint_contains: [],
    exclude_container_hint_contains: [],
    score: sc,
  }));

  // Fallback candidate when hrefs are sparse: use label/role-only seed.
  if (!seeds.length && rows.length) {
    seeds.push({
      key: 'seed-label-role',
      title: 'Label/Role seed',
      href_contains: [],
      label_contains_any: topLabels,
      exclude_label_contains_any: [],
      role_allowlist: topRoles,
      must_be_within_roles: [],
      exclude_within_roles: [],
      container_hint_contains: [],
      exclude_container_hint_contains: [],
      score: 1,
    });
  }
  return seeds;
}

type WorkflowRequest = {
  nonce: number;
  tabId: string;
  action: 'observe' | 'annotate' | 'validate' | 'synthesize' | 'refresh';
  hrefPattern?: string;
  source?: 'chat' | 'system' | 'sidebar';
  preferFullscreen?: boolean;
};

type WorkflowBuilderPanelProps = {
  tabs: BrowserTab[];
  selectedTabId: string;
  actionRequest: WorkflowRequest | null;
  onSelectTab: (tabId: string) => void;
  onValidationSummary: (tabId: string, fitScore: number) => void;
  onAnnotationCount: (tabId: string, count: number) => void;
  onTabError: (tabId: string, message: string | null) => void;
  onRefreshTab: (tabId: string) => void;
  onRunningAction: (tabId: string, action: string | null) => void;
};

function WorkflowBuilderPanel({
  tabs,
  selectedTabId,
  actionRequest,
  onSelectTab,
  onValidationSummary,
  onAnnotationCount,
  onTabError,
  onRefreshTab,
  onRunningAction,
}: WorkflowBuilderPanelProps) {
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [collectionTarget, setCollectionTarget] = useState<CollectionTarget>('posts');
  const [goalText, setGoalText] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hrefPattern, setHrefPattern] = useState('/');
  const [labelIncludeTokens, setLabelIncludeTokens] = useState<string[]>([]);
  const [labelExcludeTokens, setLabelExcludeTokens] = useState<string[]>([]);
  const [roleAllowlist, setRoleAllowlist] = useState<string[]>([]);
  const [mustBeWithinRoles, setMustBeWithinRoles] = useState<string[]>([]);
  const [excludeWithinRoles, setExcludeWithinRoles] = useState<string[]>([]);
  const [containerHintIncludes, setContainerHintIncludes] = useState<string[]>([]);
  const [containerHintExcludes, setContainerHintExcludes] = useState<string[]>([]);
  const [includeIds, setIncludeIds] = useState<string[]>([]);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [resultsView, setResultsView] = useState<'candidates' | 'annotations'>('candidates');
  const [imgSize, setImgSize] = useState({ naturalW: 1, naturalH: 1, clientW: 1, clientH: 1 });
  const lastHandledActionNonceRef = useRef(0);

  const observationMutation = useMutation({
    mutationFn: async () => api.getBrowserObservationPack({ tab_id: selectedTabId, include_screenshot: false, include_semantic_nodes: true }),
    onMutate: () => onRunningAction(selectedTabId, 'observe'),
    onSuccess: (data) => {
      onTabError(selectedTabId, null);
      setWizardStep(2);
      const suggested = extractCandidateSeeds(data.observation as Record<string, unknown>)[0];
      if (!suggested) return;
      if (!hrefPattern.trim() || hrefPattern.trim() === '/') {
        setHrefPattern((suggested.href_contains || [])[0] || '');
      }
      if (!labelIncludeTokens.length && (suggested.label_contains_any || []).length) {
        setLabelIncludeTokens(suggested.label_contains_any || []);
      }
      if (!roleAllowlist.length && (suggested.role_allowlist || []).length) {
        setRoleAllowlist(suggested.role_allowlist || []);
      }
      if (!mustBeWithinRoles.length && (suggested.must_be_within_roles || []).length) {
        setMustBeWithinRoles(suggested.must_be_within_roles || []);
      }
      if (!excludeWithinRoles.length && (suggested.exclude_within_roles || []).length) {
        setExcludeWithinRoles(suggested.exclude_within_roles || []);
      }
      if (!containerHintIncludes.length && (suggested.container_hint_contains || []).length) {
        setContainerHintIncludes(suggested.container_hint_contains || []);
      }
      if (!containerHintExcludes.length && (suggested.exclude_container_hint_contains || []).length) {
        setContainerHintExcludes(suggested.exclude_container_hint_contains || []);
      }
      setWizardStep(3);
    },
    onError: (err) => onTabError(selectedTabId, err instanceof Error ? err.message : 'Observation failed'),
    onSettled: () => onRunningAction(selectedTabId, null),
  });

  const validateMutation = useMutation({
    mutationFn: async () =>
      api.validateBrowserCandidate({
        tab_id: selectedTabId,
        href_contains: hrefPattern.trim() ? [hrefPattern.trim()] : ['/'],
        label_contains_any: labelIncludeTokens,
        exclude_label_contains_any: labelExcludeTokens,
        role_allowlist: roleAllowlist,
        must_be_within_roles: mustBeWithinRoles,
        exclude_within_roles: excludeWithinRoles,
        container_hint_contains: containerHintIncludes,
        exclude_container_hint_contains: containerHintExcludes,
        min_items: 1,
        max_items: 200,
        required_fields: ['name', 'url'],
      }),
    onMutate: () => onRunningAction(selectedTabId, 'validate'),
    onSuccess: (data) => {
      const fitScore = Number((data.candidate_validation as Record<string, unknown> | undefined)?.fit_score || 0);
      onValidationSummary(selectedTabId, Number.isFinite(fitScore) ? fitScore : 0);
      onTabError(selectedTabId, null);
      setWizardStep(4);
    },
    onError: (err) => onTabError(selectedTabId, err instanceof Error ? err.message : 'Validation failed'),
    onSettled: () => onRunningAction(selectedTabId, null),
  });

  const annotateMutation = useMutation({
    mutationFn: async () =>
      api.annotateBrowserCandidate({
        tab_id: selectedTabId,
        href_contains: hrefPattern.trim() ? [hrefPattern.trim()] : ['/'],
        max_boxes: 40,
        include_screenshot: true,
      }),
    onMutate: () => onRunningAction(selectedTabId, 'annotate'),
    onSuccess: (data) => {
      setIncludeIds([]);
      setExcludeIds([]);
      const nextCount = data.annotation?.boxes?.length || 0;
      onAnnotationCount(selectedTabId, nextCount);
      if (nextCount > 0) setResultsView('annotations');
      onTabError(selectedTabId, null);
      setWizardStep(3);
    },
    onError: (err) => onTabError(selectedTabId, err instanceof Error ? err.message : 'Annotation failed'),
    onSettled: () => onRunningAction(selectedTabId, null),
  });

  const synthMutation = useMutation({
    mutationFn: async () =>
      api.synthesizeBrowserCandidateFromFeedback({
        tab_id: selectedTabId,
        boxes: ((annotateMutation.data?.annotation?.boxes || []) as Array<Record<string, unknown>>),
        include_box_ids: includeIds,
        exclude_box_ids: excludeIds,
        fallback_href_contains: hrefPattern.trim() ? [hrefPattern.trim()] : ['/'],
        required_fields: ['name', 'url'],
        min_items: 1,
        max_items: 200,
      }),
    onMutate: () => onRunningAction(selectedTabId, 'synthesize'),
    onSuccess: (data) => {
      const suggested = data.suggested_href_contains?.[0];
      if (suggested) setHrefPattern(suggested);
      if (data.suggested_candidate?.label_contains_any) setLabelIncludeTokens(data.suggested_candidate.label_contains_any);
      if (data.suggested_candidate?.exclude_label_contains_any) setLabelExcludeTokens(data.suggested_candidate.exclude_label_contains_any);
      if (data.suggested_candidate?.role_allowlist) setRoleAllowlist(data.suggested_candidate.role_allowlist);
      if (data.suggested_candidate?.must_be_within_roles) setMustBeWithinRoles(data.suggested_candidate.must_be_within_roles);
      if (data.suggested_candidate?.exclude_within_roles) setExcludeWithinRoles(data.suggested_candidate.exclude_within_roles);
      if (data.suggested_candidate?.container_hint_contains) setContainerHintIncludes(data.suggested_candidate.container_hint_contains);
      if (data.suggested_candidate?.exclude_container_hint_contains) setContainerHintExcludes(data.suggested_candidate.exclude_container_hint_contains);
      const fitScore = Number((data.candidate_validation as Record<string, unknown> | undefined)?.fit_score || 0);
      onValidationSummary(selectedTabId, Number.isFinite(fitScore) ? fitScore : 0);
      onTabError(selectedTabId, null);
      setWizardStep(4);
    },
    onError: (err) => onTabError(selectedTabId, err instanceof Error ? err.message : 'Synthesis failed'),
    onSettled: () => onRunningAction(selectedTabId, null),
  });
  useEffect(() => {
    if (!actionRequest) return;
    if (actionRequest.tabId !== selectedTabId) return;
    if (actionRequest.nonce === lastHandledActionNonceRef.current) return;
    lastHandledActionNonceRef.current = actionRequest.nonce;
    if (typeof actionRequest.hrefPattern === 'string' && actionRequest.hrefPattern.trim()) {
      setHrefPattern(actionRequest.hrefPattern.trim());
    }
    if (actionRequest.action === 'observe') {
      setWizardStep(2);
      observationMutation.mutate();
    }
    if (actionRequest.action === 'annotate') {
      setWizardStep(3);
      annotateMutation.mutate();
    }
    if (actionRequest.action === 'validate') {
      setWizardStep(4);
      validateMutation.mutate();
    }
    if (actionRequest.action === 'synthesize') {
      setWizardStep(4);
      synthMutation.mutate();
    }
    if (actionRequest.action === 'refresh') onRefreshTab(selectedTabId);
  }, [actionRequest, annotateMutation, observationMutation, onRefreshTab, selectedTabId, synthMutation, validateMutation]);

  const boxes: BrowserAnnotationBox[] = annotateMutation.data?.annotation?.boxes || [];
  const screenshot = annotateMutation.data?.annotation?.screenshot_base64 || '';
  const fitScore = Number((synthMutation.data?.candidate_validation as Record<string, unknown> | undefined)?.fit_score || 0);
  const candidateSeeds = useMemo(
    () => extractCandidateSeeds(observationMutation.data?.observation as Record<string, unknown> | undefined),
    [observationMutation.data?.observation],
  );

  useEffect(() => {
    if (resultsView === 'annotations' && boxes.length === 0) {
      setResultsView('candidates');
    }
  }, [boxes.length, resultsView]);

  const applySeed = (seed: CandidateSeed) => {
    setHrefPattern(seed.href_contains[0] || '');
    setLabelIncludeTokens(seed.label_contains_any || []);
    setLabelExcludeTokens(seed.exclude_label_contains_any || []);
    setRoleAllowlist(seed.role_allowlist || []);
    setMustBeWithinRoles(seed.must_be_within_roles || []);
    setExcludeWithinRoles(seed.exclude_within_roles || []);
    setContainerHintIncludes(seed.container_hint_contains || []);
    setContainerHintExcludes(seed.exclude_container_hint_contains || []);
  };

  const mark = (boxId: string, mode: 'include' | 'exclude' | 'clear') => {
    if (mode === 'include') {
      setIncludeIds((prev) => Array.from(new Set([...prev, boxId])));
      setExcludeIds((prev) => prev.filter((x) => x !== boxId));
      return;
    }
    if (mode === 'exclude') {
      setExcludeIds((prev) => Array.from(new Set([...prev, boxId])));
      setIncludeIds((prev) => prev.filter((x) => x !== boxId));
      return;
    }
    setIncludeIds((prev) => prev.filter((x) => x !== boxId));
    setExcludeIds((prev) => prev.filter((x) => x !== boxId));
  };

  const scaleX = imgSize.clientW / Math.max(1, imgSize.naturalW);
  const scaleY = imgSize.clientH / Math.max(1, imgSize.naturalH);

  const boxColumns: ColumnDef<BrowserAnnotationBox>[] = [
    {
      accessorKey: 'box_id',
      header: 'Box',
      cell: ({ row }) => <span className="break-all font-mono text-[11px]">{row.original.box_id}</span>,
    },
    {
      id: 'label_href',
      header: 'Label/Href',
      cell: ({ row }) => {
        const box = row.original;
        return (
          <div>
            <div className="break-words whitespace-normal">{box.label || '(no label)'}</div>
            <div className="break-all whitespace-normal text-[10px] text-text-dim">{box.href || ''}</div>
            <div className="break-words whitespace-normal text-[10px] text-text-dim">
              role: {box.role || '(none)'} | landmark: {box.landmark_role || '(none)'}
            </div>
            <div className="break-words whitespace-normal text-[10px] text-text-dim">container: {box.container_hint || '(none)'}</div>
          </div>
        );
      },
    },
    {
      id: 'mark',
      header: 'Mark',
      cell: ({ row }) => {
        const box = row.original;
        const include = includeIds.includes(box.box_id);
        const exclude = excludeIds.includes(box.box_id);
        return (
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => mark(box.box_id, 'include')} className={`rounded px-1.5 py-0.5 text-[10px] ${include ? 'bg-green-600 text-white' : 'border border-border text-text-dim'}`}>Include</button>
            <button type="button" onClick={() => mark(box.box_id, 'exclude')} className={`rounded px-1.5 py-0.5 text-[10px] ${exclude ? 'bg-red-600 text-white' : 'border border-border text-text-dim'}`}>Exclude</button>
            <button type="button" onClick={() => mark(box.box_id, 'clear')} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim">Clear</button>
          </div>
        );
      },
    },
  ];

  const boxTable = useReactTable({
    data: boxes,
    columns: boxColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const candidateColumns: ColumnDef<CandidateSeed>[] = [
    {
      accessorKey: 'title',
      header: 'Pattern',
      cell: ({ row }) => <span className="break-all text-[11px] font-medium text-text">{row.original.title}</span>,
    },
    {
      id: 'details',
      header: 'Details',
      cell: ({ row }) => {
        const seed = row.original;
        return (
          <div className="space-y-0.5 text-[10px] text-text-dim">
            <div className="break-all">href: {(seed.href_contains || []).join(', ') || '(none)'}</div>
            <div className="break-words">labels: {(seed.label_contains_any || []).join(', ') || '(none)'}</div>
            <div className="break-words">roles: {(seed.role_allowlist || []).join(', ') || '(none)'}</div>
            <div className="break-words">within: {(seed.must_be_within_roles || []).join(', ') || '(none)'}</div>
            <div className="break-words">container: {(seed.container_hint_contains || []).join(', ') || '(none)'}</div>
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const seed = row.original;
        return (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => {
                applySeed(seed);
                validateMutation.mutate();
              }}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover"
            >
              Use then Test
            </button>
            <button
              type="button"
              onClick={() => {
                applySeed(seed);
                annotateMutation.mutate();
              }}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover"
            >
              Use then Pick
            </button>
          </div>
        );
      },
    },
  ];

  const candidateTable = useReactTable({
    data: candidateSeeds,
    columns: candidateColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const includeCount = includeIds.length;
  const excludeCount = excludeIds.length;
  const hasObservation = Boolean(observationMutation.data?.observation);
  const hasBoxes = boxes.length > 0;
  const hasRuleScore = Number.isFinite(fitScore) && fitScore > 0;

  const applyTargetPreset = (target: CollectionTarget) => {
    const previousPreset = TARGET_PRESETS[collectionTarget].pattern;
    const nextPreset = TARGET_PRESETS[target].pattern;
    setCollectionTarget(target);
    if (!hrefPattern.trim() || hrefPattern.trim() === '/' || hrefPattern.trim() === previousPreset) {
      setHrefPattern(nextPreset);
    }
  };

  const saveSetupDraft = () => {
    const activeTab = tabs.find((tab) => tab.id === selectedTabId);
    const sourceUrl = activeTab?.url || '';
    const domain = extractDomain(sourceUrl);
    const key = 'browser-workbench:setup-drafts';
    const draft = {
      saved_at: new Date().toISOString(),
      tab_id: selectedTabId,
      url: sourceUrl,
      domain,
      target: collectionTarget,
      goal: goalText.trim(),
      href_pattern: hrefPattern,
      include_count: includeCount,
      exclude_count: excludeCount,
      fit_score: hasRuleScore ? fitScore : null,
    };
    try {
      const raw = localStorage.getItem(key);
      const existing = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(existing) ? existing.filter((row) => row && row.domain !== domain) : [];
      next.unshift(draft);
      localStorage.setItem(key, JSON.stringify(next.slice(0, 30)));
      setSaveMessage(`Saved setup for ${domain}.`);
      window.setTimeout(() => setSaveMessage(null), 2500);
    } catch {
      setSaveMessage('Saved setup.');
      window.setTimeout(() => setSaveMessage(null), 2500);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface p-3 touch-pan-y">
      <div className="shrink-0">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-1 text-sm font-semibold text-text">
            <Wand2 className="h-4 w-4" /> Automation Setup
          </h2>
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="rounded border border-border px-2 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover"
          >
            {showAdvanced ? 'Hide Advanced' : 'Advanced'}
          </button>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1 text-[10px] sm:grid-cols-4">
          {[
            { id: 1, label: 'Choose Goal' },
            { id: 2, label: 'Scan Page' },
            { id: 3, label: 'Pick Examples' },
            { id: 4, label: 'Finalize' },
          ].map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => setWizardStep(step.id as WizardStep)}
              className={`rounded border px-2 py-1 text-left ${
                wizardStep === step.id
                  ? 'border-accent bg-accent text-white'
                  : (wizardStep > step.id ? 'border-green-300 bg-green-50 text-green-700' : 'border-border text-text-dim')
              }`}
            >
              <span className="font-semibold">Step {step.id}</span>
              <span className="ml-1">{step.label}</span>
            </button>
          ))}
        </div>

        <div className="mb-3 rounded border border-border bg-bg p-2">
          <label className="mb-2 block text-xs text-text-dim">
            Current tab
            <select value={selectedTabId} onChange={(e) => onSelectTab(e.target.value)} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text">
              {tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.id} {tab.active ? '(active)' : ''} {tab.title ? `- ${tab.title}` : ''}
                </option>
              ))}
            </select>
          </label>

          {wizardStep === 1 ? (
            <div className="space-y-2">
              <div className="text-xs text-text-dim">What do you want to collect?</div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {(Object.keys(TARGET_PRESETS) as CollectionTarget[]).map((target) => (
                  <button
                    key={target}
                    type="button"
                    onClick={() => applyTargetPreset(target)}
                    className={`rounded border px-2 py-1 text-xs ${collectionTarget === target ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-dim hover:bg-surface-hover'}`}
                  >
                    {TARGET_PRESETS[target].label}
                  </button>
                ))}
              </div>
              <label className="block text-xs text-text-dim">
                Optional topic or goal
                <input
                  value={goalText}
                  onChange={(e) => setGoalText(e.target.value)}
                  placeholder="e.g. AI posts in r/startups"
                  className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text"
                />
              </label>
              <div className="text-[11px] text-text-dim">{TARGET_PRESETS[collectionTarget].helper}</div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  disabled={!selectedTabId}
                  className="rounded bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {wizardStep === 2 ? (
            <div className="space-y-2">
              <div className="text-xs text-text-dim">Scan this page so we can detect possible results automatically.</div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => observationMutation.mutate()}
                  disabled={!selectedTabId || observationMutation.isPending}
                  className="rounded border border-border px-2 py-1 text-xs text-text hover:bg-surface-hover disabled:opacity-50"
                >
                  {observationMutation.isPending ? 'Scanning...' : 'Scan Page'}
                </button>
                <button type="button" onClick={() => onRefreshTab(selectedTabId)} className="rounded border border-border px-2 py-1 text-xs text-text-dim hover:bg-surface-hover">
                  Refresh Tab
                </button>
              </div>
              {hasObservation ? (
                <div className="text-[11px] text-text-dim">
                  Scan complete: page mode {String(observationMutation.data?.observation?.page_mode || 'unknown')} on {String(observationMutation.data?.observation?.domain || 'n/a')}.
                </div>
              ) : null}
              <div className="flex justify-between">
                <button type="button" onClick={() => setWizardStep(1)} className="rounded border border-border px-2 py-1 text-xs text-text-dim hover:bg-surface-hover">
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep(3)}
                  disabled={!hasObservation}
                  className="rounded bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {wizardStep === 3 ? (
            <div className="space-y-2">
              <div className="text-xs text-text-dim">Pick good and bad examples so the system learns the right pattern.</div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => annotateMutation.mutate()}
                  disabled={!selectedTabId || annotateMutation.isPending}
                  className="rounded border border-border px-2 py-1 text-xs text-text hover:bg-surface-hover disabled:opacity-50"
                >
                  {annotateMutation.isPending ? 'Picking...' : 'Pick Examples'}
                </button>
                <button type="button" onClick={() => setResultsView('annotations')} className="rounded border border-border px-2 py-1 text-xs text-text-dim hover:bg-surface-hover">
                  View Marked Items
                </button>
              </div>
              <div className="text-[11px] text-text-dim">
                Included: {includeCount} | Excluded: {excludeCount} | Total rows: {boxes.length}
              </div>
              <div className="flex justify-between">
                <button type="button" onClick={() => setWizardStep(2)} className="rounded border border-border px-2 py-1 text-xs text-text-dim hover:bg-surface-hover">
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep(4)}
                  disabled={!hasBoxes}
                  className="rounded bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {wizardStep === 4 ? (
            <div className="space-y-2">
              <div className="text-xs text-text-dim">Test and auto-fix the extraction rule, then save this setup.</div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => validateMutation.mutate()}
                  disabled={!selectedTabId || validateMutation.isPending}
                  className="rounded border border-border px-2 py-1 text-xs text-text hover:bg-surface-hover disabled:opacity-50"
                >
                  {validateMutation.isPending ? 'Testing...' : 'Test Results'}
                </button>
                <button
                  type="button"
                  onClick={() => synthMutation.mutate()}
                  disabled={!boxes.length || synthMutation.isPending}
                  className="rounded bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  {synthMutation.isPending ? 'Auto-fixing...' : 'Auto-Fix Rules'}
                </button>
                <button
                  type="button"
                  onClick={saveSetupDraft}
                  disabled={!selectedTabId}
                  className="rounded border border-border px-2 py-1 text-xs text-text-dim hover:bg-surface-hover disabled:opacity-50"
                >
                  Save Setup
                </button>
              </div>
              {saveMessage ? <div className="text-[11px] text-green-700">{saveMessage}</div> : null}
              {showAdvanced ? (
                <label className="block text-xs text-text-dim">
                  Link pattern (advanced)
                  <input value={hrefPattern} onChange={(e) => setHrefPattern(e.target.value)} placeholder="/comments/" className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text" />
                </label>
              ) : null}
              <div className="text-[11px] text-text-dim">Rule fit score: {hasRuleScore ? fitScore : 0}</div>
              <div className="flex justify-start">
                <button type="button" onClick={() => setWizardStep(3)} className="rounded border border-border px-2 py-1 text-xs text-text-dim hover:bg-surface-hover">
                  Back
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {observationMutation.data?.observation ? (
          <div className="mb-2 text-[11px] text-text-dim">
            page_mode: {String(observationMutation.data.observation.page_mode || 'unknown')} | domain: {String(observationMutation.data.observation.domain || 'n/a')}
          </div>
        ) : null}
        {wizardStep < 3 ? (
          <div className="mb-2 text-xs text-text-dim">Complete the first steps above to unlock examples and rule suggestions.</div>
        ) : null}

        {wizardStep >= 3 && candidateSeeds.length && boxes.length > 0 ? (
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setResultsView('candidates')}
              className={`rounded px-2 py-0.5 text-[10px] ${resultsView === 'candidates' ? 'bg-accent text-white' : 'border border-border text-text-dim hover:bg-surface-hover'}`}
            >
              Suggested Rules
            </button>
            <button
              type="button"
              onClick={() => setResultsView('annotations')}
              className={`rounded px-2 py-0.5 text-[10px] ${resultsView === 'annotations' ? 'bg-accent text-white' : 'border border-border text-text-dim hover:bg-surface-hover'}`}
            >
              Marked Items
            </button>
          </div>
        ) : null}

        {wizardStep >= 3 && resultsView === 'candidates' && candidateSeeds.length ? (
          <div className="mb-2">
            <div className="mb-1 text-[11px] text-text-dim">Suggested rules. Pick one to reuse and test.</div>
            <div className="max-h-[24vh] overflow-x-auto overflow-y-auto rounded border border-border touch-pan-y">
              <table className="w-full table-fixed text-xs">
                <thead className="sticky top-0 z-10 bg-surface">
                  {candidateTable.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="border-b border-border">
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="px-2 py-1 text-left">
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {candidateTable.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-2 py-1 align-top">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {wizardStep >= 3 && resultsView === 'annotations' && screenshot ? (
          <div className="mb-3 max-h-[22vh] shrink-0 overflow-hidden rounded border border-border bg-bg p-2 touch-pan-y">
            <div className="relative inline-block">
              <img
                src={`data:image/jpeg;base64,${screenshot}`}
                alt="Annotation candidate screenshot"
                className="max-w-full"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setImgSize({
                    naturalW: img.naturalWidth || 1,
                    naturalH: img.naturalHeight || 1,
                    clientW: img.clientWidth || 1,
                    clientH: img.clientHeight || 1,
                  });
                }}
              />
              {boxes.map((box, i) => {
                const hasCoords = typeof box.x === 'number' && typeof box.y === 'number' && typeof box.width === 'number' && typeof box.height === 'number';
                if (!hasCoords) return null;
                const isInclude = includeIds.includes(box.box_id);
                const isExclude = excludeIds.includes(box.box_id);
                const color = isInclude ? 'border-green-500 bg-green-500/15' : isExclude ? 'border-red-500 bg-red-500/15' : 'border-cyan-500 bg-cyan-500/10';
                return (
                  <div
                    key={box.box_id}
                    className={`pointer-events-none absolute border ${color}`}
                    style={{
                      left: `${(box.x || 0) * scaleX}px`,
                      top: `${(box.y || 0) * scaleY}px`,
                      width: `${(box.width || 0) * scaleX}px`,
                      height: `${(box.height || 0) * scaleY}px`,
                    }}
                  >
                    <span className="absolute left-0 top-0 bg-black/65 px-1 text-[10px] text-white">#{i + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {wizardStep >= 3 && resultsView === 'annotations' && boxes.length > 0 ? (
          <div className="max-h-[42vh] overflow-x-auto overflow-y-auto rounded border border-border touch-pan-y">
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 z-10 bg-surface">
                {boxTable.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b border-border">
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} className="px-2 py-1 text-left">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {boxTable.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-2 py-1 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : wizardStep >= 3 && resultsView === 'annotations' ? (
          <div className="text-xs text-text-dim">Click Pick Examples to load rows you can mark as Include or Exclude.</div>
        ) : null}

        {wizardStep >= 4 && synthMutation.data ? (
          <div className="mt-2 rounded border border-border bg-bg p-2 text-xs">
            <div className="font-medium text-text">Suggested rule</div>
            <div className="mt-1 font-mono text-[11px] text-accent">{(synthMutation.data.suggested_href_contains || []).join(', ') || '(none)'}</div>
            {synthMutation.data.suggested_candidate ? (
              <div className="mt-1 text-[11px] text-text-dim">
                labels+: {(synthMutation.data.suggested_candidate.label_contains_any || []).join(', ') || '(none)'} | labels-:{' '}
                {(synthMutation.data.suggested_candidate.exclude_label_contains_any || []).join(', ') || '(none)'} | roles:{' '}
                {(synthMutation.data.suggested_candidate.role_allowlist || []).join(', ') || '(none)'} | within:{' '}
                {(synthMutation.data.suggested_candidate.must_be_within_roles || []).join(', ') || '(none)'} | exclude_within:{' '}
                {(synthMutation.data.suggested_candidate.exclude_within_roles || []).join(', ') || '(none)'} | container+:{' '}
                {(synthMutation.data.suggested_candidate.container_hint_contains || []).join(', ') || '(none)'} | container-:{' '}
                {(synthMutation.data.suggested_candidate.exclude_container_hint_contains || []).join(', ') || '(none)'}
              </div>
            ) : null}
            <div className="mt-1 text-text-dim">Rule fit score: {Number.isFinite(fitScore) ? fitScore : 0}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
function BrowserLiveViewer({
  tab,
  screenshot,
  loading,
  error,
  onRefresh,
}: {
  tab: WorkbenchTab | null;
  screenshot: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (!tab) return <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface text-sm text-text-dim">No browser tabs available</div>;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-surface p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-text">{tab.title}</div>
          <div className="truncate text-xs text-text-dim">{tab.url}</div>
        </div>
        <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-dim hover:bg-surface-hover">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded border border-border bg-bg p-1">
        {screenshot ? (
          <div className="h-full w-full overflow-hidden">
            <img
              src={screenshot}
              alt={`Live tab ${tab.id}`}
              className="block h-full w-full object-contain object-top"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-text-dim">
            {loading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
              </span>
            ) : (
              error || 'No frame yet'
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BrowserWorkbenchPage() {
  const { setPageContext } = usePageContext();
  const workspace = useWorkspaceLayout();
  useRegisterCapabilities(getPageCapability('browser'));
  const isPhone = useIsMobile(640);
  const detailsPanelRef = useRef<HTMLDivElement>(null);

  const [tabSearch, setTabSearch] = useState('');
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false);
  const [workflowDrawerOpenToHalfNonce, setWorkflowDrawerOpenToHalfNonce] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState<string>('browser-tabs');

  const [selectedTabId, setSelectedTabId] = useState<string>('');
  const [selectedBrowserDetailsTabId, setSelectedBrowserDetailsTabId] = useState<string | null>(null);
  const [lastUsedAt, setLastUsedAt] = useState<Record<string, number>>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Record<string, number>>({});
  const [runningActionByTab, setRunningActionByTab] = useState<Record<string, string | null>>({});
  const [lastErrorByTab, setLastErrorByTab] = useState<Record<string, string | null>>({});
  const [annotationCountByTab, setAnnotationCountByTab] = useState<Record<string, number>>({});
  const [validationByTab, setValidationByTab] = useState<Record<string, TabValidationSummary>>({});
  const [screenshotByTab, setScreenshotByTab] = useState<Record<string, string>>({});
  const [loadingShotByTab, setLoadingShotByTab] = useState<Record<string, boolean>>({});
  const [workflowRequest, setWorkflowRequest] = useState<WorkflowRequest | null>(null);
  const workflowNonceRef = useRef(0);

  useEffect(() => {
    setPageContext({ listContext: 'browser' });
  }, [setPageContext]);

  const tabsQ = useQuery({
    queryKey: ['browser', 'tabs', 'workbench'],
    queryFn: () => api.getBrowserTabs(),
    refetchInterval: 2000,
  });
  const workflowTasksQ = useQuery({
    queryKey: ['browser', 'workflowTasks', 'workbench'],
    queryFn: () => api.getBrowserWorkflowTasks({ includeFinished: true, limit: 16 }),
    refetchInterval: 2000,
  });

  const tabs = useMemo(() => tabsQ.data?.tabs || [], [tabsQ.data?.tabs]);
  const tabsOrdered = useMemo(
    () =>
      tabs
        .map((tab, idx) => ({ tab, idx }))
        .sort((a, b) => resolveTabOrder(a.tab, a.idx) - resolveTabOrder(b.tab, b.idx))
        .map(({ tab }) => tab),
    [tabs]
  );
  const taskRows = useMemo(() => {
    const rows = workflowTasksQ.data?.tasks || [];
    return [...rows]
      .filter((task) => resolveWorkflowTaskTabId(task))
      .sort((a, b) => Number(a.updated_at || 0) - Number(b.updated_at || 0))
      .slice(0, 40);
  }, [workflowTasksQ.data?.tasks]);
  const taskTabs = useMemo<BrowserFlowSelection[]>(() => {
    const tasksByTabId = new Map<string, BrowserWorkflowTask[]>();
    for (const task of taskRows) {
      const tabId = resolveWorkflowTaskTabId(task);
      if (!tabId) continue;
      const existing = tasksByTabId.get(tabId) || [];
      existing.push(task);
      tasksByTabId.set(tabId, existing);
    }
    const anchors = tabsOrdered
      .map((tab, idx) => ({ tab, idx, tasks: tasksByTabId.get(tab.id) || [] }))
      .filter((row) => row.tasks.length > 0);

    if (!anchors.length) {
      return [];
    }
    const flows: BrowserFlowSelection[] = [];
    anchors.forEach(({ tab, idx, tasks }, anchorIndex) => {
      const sortedTasks = [...tasks].sort((a, b) => Number(a.updated_at || 0) - Number(b.updated_at || 0));
      const meaningful = sortedTasks.filter((task) => !isHelperBrowserOperation(task));
      const flowTasks = meaningful.length ? meaningful : [sortedTasks[sortedTasks.length - 1]];
      const latestTask = flowTasks[flowTasks.length - 1] || sortedTasks[sortedTasks.length - 1];
      const nextOrderIndex = anchors[anchorIndex + 1]?.idx ?? tabsOrdered.length;
      const contiguousTabs = tabsOrdered.slice(idx, nextOrderIndex).map((row) => row.id);
      flows.push({
        id: `flow:${tab.id}`,
        label: browserFlowLabel(tab, flowTasks),
        status: String(latestTask?.status || ''),
        stage: String(latestTask?.stage || ''),
        tabId: tab.id,
        count: contiguousTabs.length,
        tabsOwned: contiguousTabs,
      });
    });
    return flows;
  }, [tabsOrdered, taskRows]);
  const topLevelTabs = useMemo(
    () => [{ id: 'browser-tabs', label: 'Browser Tabs', count: tabsOrdered.length }, ...taskTabs],
    [tabsOrdered.length, taskTabs]
  );
  const selectedTask = useMemo(
    () => taskTabs.find((task) => task.id === activeTaskId) || null,
    [activeTaskId, taskTabs]
  );
  const browserTabsMode = activeTaskId === 'browser-tabs';
  const selectedTaskTabIds = useMemo(() => {
    if (browserTabsMode || !selectedTask || selectedTask.id === 'browser-live') return tabsOrdered.map((tab) => tab.id);
    return selectedTask.tabsOwned.length ? selectedTask.tabsOwned : selectedTask.tabId ? [selectedTask.tabId] : tabsOrdered.map((tab) => tab.id);
  }, [browserTabsMode, selectedTask, tabsOrdered]);
  useEffect(() => {
    if (!tabs.length) {
      setSelectedTabId('');
      return;
    }
    if (tabs.some((tab) => tab.id === selectedTabId)) return;
    const serverActive = tabsQ.data?.active_tab_id;
    if (serverActive && tabs.some((tab) => tab.id === serverActive)) {
      setSelectedTabId(serverActive);
      return;
    }
    const localActive = tabs.find((tab) => tab.active)?.id;
    if (localActive) {
      setSelectedTabId(localActive);
      return;
    }
    setSelectedTabId(tabs[0]?.id || '');
  }, [selectedTabId, tabs, tabsQ.data?.active_tab_id]);

  useEffect(() => {
    if (!topLevelTabs.length) {
      setActiveTaskId('browser-tabs');
      return;
    }
    if (topLevelTabs.some((tab) => tab.id === activeTaskId)) return;
    setActiveTaskId(topLevelTabs[0]?.id || 'browser-tabs');
  }, [activeTaskId, topLevelTabs]);

  useEffect(() => {
    if (browserTabsMode) return;
    if (!selectedTask?.tabId) return;
    if (!tabs.some((tab) => tab.id === selectedTask.tabId)) return;
    setSelectedTabId(selectedTask.tabId);
    setLastUsedAt((prev) => ({ ...prev, [selectedTask.tabId]: Date.now() }));
  }, [browserTabsMode, selectedTask?.id, selectedTask?.tabId, tabs]);

  useEffect(() => {
    if (!selectedTaskTabIds.length) {
      setSelectedTabId('');
      return;
    }
    if (selectedTaskTabIds.includes(selectedTabId)) return;
    setSelectedTabId(selectedTaskTabIds[0] || '');
  }, [selectedTabId, selectedTaskTabIds]);

  useEffect(() => {
    if (!tabs.length) return;
    const now = Date.now();
    setLastUpdatedAt((prev) => {
      const next = { ...prev };
      tabs.forEach((tab) => {
        if (!next[tab.id]) next[tab.id] = now;
      });
      return next;
    });
    setLastUsedAt((prev) => {
      const next = { ...prev };
      tabs.forEach((tab) => {
        if (!next[tab.id]) next[tab.id] = now;
      });
      if (selectedTabId) next[selectedTabId] = now;
      return next;
    });
  }, [selectedTabId, tabs]);

  const updateValidation = (tabId: string, fitScore: number) => {
    setValidationByTab((prev) => ({
      ...prev,
      [tabId]: {
        fitScore,
        status: fitScore >= 0.75 ? 'pass' : fitScore > 0 ? 'fail' : 'unknown',
        checkedAt: Date.now(),
      },
    }));
  };

  const updateTabError = (tabId: string, error: string | null) => {
    setLastErrorByTab((prev) => ({ ...prev, [tabId]: error }));
  };
  const fetchScreenshot = async (tabId: string, silent = false) => {
    if (!tabId) return;
    if (!silent) setRunningActionByTab((prev) => ({ ...prev, [tabId]: 'refresh' }));
    setLoadingShotByTab((prev) => ({ ...prev, [tabId]: true }));
    try {
      const shot = await api.getBrowserScreenshot(tabId);
      const base64 = (typeof shot.base64 === 'string' && shot.base64) || (typeof shot.image === 'string' && shot.image) || '';
      const mime = typeof shot.mime === 'string' && shot.mime ? shot.mime : 'image/jpeg';
      if (base64) {
        setScreenshotByTab((prev) => ({ ...prev, [tabId]: `data:${mime};base64,${base64}` }));
        setLastUpdatedAt((prev) => ({ ...prev, [tabId]: Date.now() }));
        setLastErrorByTab((prev) => ({ ...prev, [tabId]: null }));
      }
    } catch (err) {
      setLastErrorByTab((prev) => ({ ...prev, [tabId]: err instanceof Error ? err.message : 'Screenshot failed' }));
    } finally {
      setLoadingShotByTab((prev) => ({ ...prev, [tabId]: false }));
      if (!silent) setRunningActionByTab((prev) => ({ ...prev, [tabId]: null }));
    }
  };

  useEffect(() => {
    if (!selectedTabId) return;
    let cancelled = false;
    let timer: number | null = null;
    const loop = async () => {
      if (cancelled) return;
      await fetchScreenshot(selectedTabId, true);
      if (!cancelled) timer = window.setTimeout(loop, 1500);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [selectedTabId]);

  const requestWorkflowAction = (tabId: string, action: WorkflowRequest['action'], options?: Omit<WorkflowRequest, 'nonce' | 'tabId' | 'action'>) => {
    workflowNonceRef.current += 1;
    const nonce = workflowNonceRef.current;
    setWorkflowRequest({ nonce, tabId, action, ...options });
  };

  useEffect(() => {
    const onCommand = (event: Event) => {
      const custom = event as CustomEvent<unknown>;
      if (!isBrowserWorkflowCommand(custom.detail)) return;
      const detail = custom.detail;
      const targetTabId = selectedTabId || tabs[0]?.id || '';
      if (!targetTabId) return;

      setSelectedTabId(targetTabId);
      setLastUsedAt((prev) => ({ ...prev, [targetTabId]: Date.now() }));
      setWorkflowDrawerOpen(true);
      if (detail.action === 'annotate' || detail.action === 'validate' || detail.action === 'synthesize') {
        setWorkflowDrawerOpenToHalfNonce((prev) => prev + 1);
      }
      if (detail.preferFullscreen) {
        workspace.setWorkspaceMode('fullscreen');
        workspace.openWorkspace({ source: 'chat', preferredMode: 'fullscreen' });
      }
      requestWorkflowAction(targetTabId, detail.action, {
        hrefPattern: detail.hrefPattern,
        source: detail.source,
        preferFullscreen: detail.preferFullscreen,
      });
    };

    window.addEventListener(BROWSER_WORKFLOW_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(BROWSER_WORKFLOW_COMMAND_EVENT, onCommand);
  }, [selectedTabId, tabs, workspace]);

  const triggerWorkflowAction = async (tabId: string, actionType: WorkflowActionType) => {
    if (!tabId) return;
    if (actionType === 'focus') {
      setSelectedTabId(tabId);
      setLastUsedAt((prev) => ({ ...prev, [tabId]: Date.now() }));
      return;
    }
    if (actionType === 'refresh') {
      await fetchScreenshot(tabId, false);
      return;
    }

    setSelectedTabId(tabId);
    setLastUsedAt((prev) => ({ ...prev, [tabId]: Date.now() }));
    setWorkflowDrawerOpen(true);
    if (actionType === 'annotate' || actionType === 'validate' || actionType === 'synthesize') {
      setWorkflowDrawerOpenToHalfNonce((prev) => prev + 1);
    }
    requestWorkflowAction(tabId, actionType);
  };

  const workbenchTabs = useMemo<WorkbenchTab[]>(() => tabs.map((tab) => {
    const url = tab.url || '';
    const domain = extractDomain(url);
    const isActive = selectedTabId === tab.id;
    const running = !!runningActionByTab[tab.id];
    const hasError = !!lastErrorByTab[tab.id];
    const status: WorkbenchTab['status'] = running ? 'running' : hasError ? 'error' : isActive || !!tab.active ? 'active' : 'idle';
    return {
      id: tab.id,
      title: tab.title || url || tab.id,
      url,
      domain,
      faviconUrl: domain && domain !== 'unknown' ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : null,
      status,
      isActive,
      isPinned: false,
      lastUsedAt: lastUsedAt[tab.id] || Date.now(),
      lastUpdatedAt: lastUpdatedAt[tab.id] || Date.now(),
      lastError: lastErrorByTab[tab.id] || null,
      hasAnnotations: (annotationCountByTab[tab.id] || 0) > 0,
      validationSummary: validationByTab[tab.id] || null,
      screenshotUrl: screenshotByTab[tab.id] || null,
    };
  }), [annotationCountByTab, lastErrorByTab, lastUpdatedAt, lastUsedAt, runningActionByTab, screenshotByTab, selectedTabId, tabs, validationByTab]);
  const visibleWorkbenchTabs = useMemo(
    () => workbenchTabs.filter((tab) => selectedTaskTabIds.includes(tab.id)),
    [selectedTaskTabIds, workbenchTabs]
  );
  const filteredWorkbenchTabs = useMemo(() => {
    const q = tabSearch.trim().toLowerCase();
    if (!q) return visibleWorkbenchTabs;
    return visibleWorkbenchTabs.filter((tab) =>
      [tab.title, tab.domain, tab.url]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [tabSearch, visibleWorkbenchTabs]);
  const selectedWorkbenchTab = useMemo(
    () => visibleWorkbenchTabs.find((tab) => tab.id === selectedTabId) || null,
    [selectedTabId, visibleWorkbenchTabs]
  );
  const selectedBrowserDetailsTab = useMemo(
    () => (selectedBrowserDetailsTabId ? workbenchTabs.find((tab) => tab.id === selectedBrowserDetailsTabId) || null : null),
    [selectedBrowserDetailsTabId, workbenchTabs]
  );
  const tasksByTabId = useMemo(() => {
    const map = new Map<string, BrowserTabDetailTask[]>();
    taskTabs.forEach((topTask) => {
      const linkedRows = taskRows.filter((row) => topTask.tabsOwned.includes(resolveWorkflowTaskTabId(row) || ''));
      linkedRows.forEach((row) => {
        const tabId = resolveWorkflowTaskTabId(row);
        if (!tabId) return;
        const existing = map.get(tabId) || [];
        existing.push({
          id: row.task_id,
          label: browserTaskLabel(row),
          status: String(row.status || ''),
          stage: String(row.stage || ''),
          topLevelTaskId: topTask.id,
        });
        map.set(tabId, existing);
      });
    });
    return map;
  }, [taskRows, taskTabs]);
  const compactLayout = workspace.open && workspace.mode === 'drawer';

  const setActiveTab = (tabId: string) => {
    setSelectedTabId(tabId);
    setLastUsedAt((prev) => ({ ...prev, [tabId]: Date.now() }));
  };
  const selectedTabLinkedTasks = useMemo(
    () => (selectedBrowserDetailsTabId ? tasksByTabId.get(selectedBrowserDetailsTabId) || [] : []),
    [selectedBrowserDetailsTabId, tasksByTabId]
  );
  const openTaskView = (taskId: string, tabId?: string) => {
    setActiveTaskId(taskId);
    if (tabId) {
      setSelectedTabId(tabId);
      setLastUsedAt((prev) => ({ ...prev, [tabId]: Date.now() }));
    }
  };

  useEffect(() => {
    if (!browserTabsMode || !selectedBrowserDetailsTab || isPhone) return;
    const id = window.requestAnimationFrame(() => detailsPanelRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [browserTabsMode, isPhone, selectedBrowserDetailsTab]);

  useEffect(() => {
    if (!selectedBrowserDetailsTabId) return;
    if (workbenchTabs.some((tab) => tab.id === selectedBrowserDetailsTabId)) return;
    setSelectedBrowserDetailsTabId(null);
  }, [selectedBrowserDetailsTabId, workbenchTabs]);

  const handleNewTab = async () => {
    try {
      await fetch('/api/browser/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'about:blank', open_new: true }),
      });
      await tabsQ.refetch();
    } catch {
      // ignore
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto md:overflow-hidden">
      <div className="flex h-full min-h-0 flex-col">
        <div className="pb-2 pt-3 md:pt-4">
          <div className="-mt-3 mb-2 flex h-14 items-end gap-2 md:-mt-4">
            <div className="min-w-0 flex-1">
              <EmailTabs
                tabs={topLevelTabs}
                activeTab={activeTaskId}
                onSelectTab={(taskId) => {
                  setActiveTaskId(taskId);
                  if (taskId === 'browser-tabs') return;
                  const nextTask = taskTabs.find((task) => task.id === taskId);
                  if (!nextTask?.tabId) return;
                  if (!tabs.some((tab) => tab.id === nextTask.tabId)) return;
                  setSelectedTabId(nextTask.tabId);
                  setLastUsedAt((prev) => ({ ...prev, [nextTask.tabId]: Date.now() }));
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                void tabsQ.refetch();
                void workflowTasksQ.refetch();
                if (selectedTabId) void fetchScreenshot(selectedTabId, false);
              }}
              className="mb-px inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-text-muted hover:bg-surface-hover hover:text-text"
              aria-label="Refresh browser workbench"
              title="Refresh browser workbench"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-[220px] flex-1">
              <PageSearchInput
                value={tabSearch}
                onChange={setTabSearch}
                placeholder={browserTabsMode ? 'Search browser tabs...' : 'Search tabs in this task...'}
              />
            </div>
            <span className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-[11px] text-text-dim">
              {filteredWorkbenchTabs.length} of {visibleWorkbenchTabs.length} tabs
            </span>
            <button
              type="button"
              onClick={() => {
                void handleNewTab();
              }}
              className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-xs text-text-dim hover:bg-surface-hover"
            >
              New Tab
            </button>
          </div>
        </div>

        <div className={`${compactLayout ? 'min-h-0 flex-1 pb-2 md:pb-2' : 'min-h-0 flex-1 pb-3 md:pb-3'}`}>
          <div className="flex h-full min-h-0 overflow-hidden bg-surface">
            {browserTabsMode ? (
              <>
                <div className="min-w-0 flex-1 overflow-auto">
                  {filteredWorkbenchTabs.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-6 text-sm text-text-dim">
                      No browser tabs found.
                    </div>
                  ) : (
                    <table className="w-full min-w-[980px] table-fixed">
                      <thead className="sticky top-0 z-10 bg-surface">
                        <tr className="h-9 border-b border-border-subtle bg-surface-hover/30">
                          <th className="w-[26%] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted">Title</th>
                          <th className="w-[12%] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted">Status</th>
                          <th className="w-[26%] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted">URL</th>
                          <th className="w-[10%] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted">Domain</th>
                          <th className="w-[10%] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted">Linked Tasks</th>
                          <th className="w-[16%] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted">Updated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {filteredWorkbenchTabs.map((tab) => {
                          const linkedTasks = tasksByTabId.get(tab.id) || [];
                          const isActive = selectedWorkbenchTab?.id === tab.id;
                          return (
                            <tr
                              key={tab.id}
                              className={`group h-[42px] cursor-pointer text-sm transition-colors ${isActive ? 'bg-accent/10' : 'hover:bg-surface-hover/60'}`}
                              onClick={() => {
                                setActiveTab(tab.id);
                                setSelectedBrowserDetailsTabId((current) => (current === tab.id ? null : tab.id));
                              }}
                              tabIndex={0}
                              aria-label={`Open details for browser tab ${browserWorkbenchTabLabel(tab)}`}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                setActiveTab(tab.id);
                                setSelectedBrowserDetailsTabId((current) => (current === tab.id ? null : tab.id));
                              }}
                            >
                              <td className="h-[42px] px-3 py-0 align-middle leading-tight">
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-text">{tab.title || 'Untitled tab'}</p>
                                  <p className="mt-0.5 truncate text-xs text-text-dim">Tab {tab.id}</p>
                                </div>
                              </td>
                              <td className="h-[42px] px-3 py-0 align-middle leading-tight">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${workbenchStatusPillClass(tab.status)}`}>{tab.status}</span>
                              </td>
                              <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">
                                <span className="block truncate" title={tab.url}>{tab.url || 'n/a'}</span>
                              </td>
                              <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">{tab.domain}</td>
                              <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">{linkedTasks.length}</td>
                              <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">{formatWorkbenchTime(tab.lastUpdatedAt)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                {!isPhone && selectedBrowserDetailsTab ? (
                  <SidePanelContainer ref={detailsPanelRef} ariaLabel="Browser tab details panel">
                    <div tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
                      <BrowserTabDetailsPanel
                        tab={selectedBrowserDetailsTab}
                        linkedTasks={selectedTabLinkedTasks}
                        onOpenTask={openTaskView}
                        onSelectTab={setActiveTab}
                        onClose={() => setSelectedBrowserDetailsTabId(null)}
                      />
                    </div>
                  </SidePanelContainer>
                ) : null}
              </>
            ) : (
              <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-bg">
                <div className="bg-bg px-3 pt-2">
                  <EmailTabs
                    tabs={filteredWorkbenchTabs.map((tab) => ({
                      id: tab.id,
                      label: browserWorkbenchTabLabel(tab),
                    }))}
                    activeTab={selectedWorkbenchTab?.id || ''}
                    onSelectTab={setActiveTab}
                  />
                </div>
                <div className="h-full">
                  <BrowserLiveViewer
                    tab={selectedWorkbenchTab}
                    screenshot={selectedTabId ? screenshotByTab[selectedTabId] || null : null}
                    loading={!!(selectedTabId && loadingShotByTab[selectedTabId])}
                    error={selectedTabId ? lastErrorByTab[selectedTabId] || null : null}
                    onRefresh={() => {
                      if (!selectedTabId) return;
                      void fetchScreenshot(selectedTabId, false);
                    }}
                  />
                </div>

                <WorkflowDrawer
                  key={workflowDrawerOpenToHalfNonce}
                  open={workflowDrawerOpen}
                  onOpenChange={setWorkflowDrawerOpen}
                  runningLabel={selectedTabId ? runningActionByTab[selectedTabId] : null}
                  bottomInsetPx={compactLayout ? 4 : 0}
                  onAction={(action) => {
                    if (!selectedTabId) return;
                    setWorkflowDrawerOpen(true);
                    if (action === 'annotate' || action === 'validate' || action === 'synthesize') {
                      setWorkflowDrawerOpenToHalfNonce((prev) => prev + 1);
                    }
                    requestWorkflowAction(selectedTabId, action);
                  }}
                >
                  {selectedTabId ? (
                    <WorkflowBuilderPanel
                      tabs={tabs.filter((tab) => selectedTaskTabIds.includes(tab.id))}
                      selectedTabId={selectedTabId}
                      actionRequest={workflowRequest}
                      onSelectTab={setActiveTab}
                      onValidationSummary={updateValidation}
                      onAnnotationCount={(tabId, count) => setAnnotationCountByTab((prev) => ({ ...prev, [tabId]: count }))}
                      onTabError={updateTabError}
                      onRefreshTab={(tabId) => {
                        void fetchScreenshot(tabId, false);
                      }}
                      onRunningAction={(tabId, action) => setRunningActionByTab((prev) => ({ ...prev, [tabId]: action }))}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface text-sm text-text-dim">
                      No active tab selected.
                    </div>
                  )}
                </WorkflowDrawer>
              </div>
            )}
          </div>
        </div>
      </div>
      {browserTabsMode && isPhone && selectedBrowserDetailsTab ? (
        <BottomDrawerContainer onClose={() => setSelectedBrowserDetailsTabId(null)} ariaLabel="Browser tab details drawer">
          <BrowserTabDetailsPanel
            tab={selectedBrowserDetailsTab}
            linkedTasks={selectedTabLinkedTasks}
            onOpenTask={openTaskView}
            onSelectTab={setActiveTab}
            onClose={() => setSelectedBrowserDetailsTabId(null)}
          />
        </BottomDrawerContainer>
      ) : null}
    </div>
  );
}

type BrowserTabDetailTask = {
  id: string;
  label: string;
  status: string;
  stage: string;
  topLevelTaskId: string;
};

function BrowserTabDetailsPanel({
  tab,
  linkedTasks,
  onOpenTask,
  onSelectTab,
  onClose,
}: {
  tab: WorkbenchTab | null;
  linkedTasks: BrowserTabDetailTask[];
  onOpenTask: (taskId: string, tabId?: string) => void;
  onSelectTab: (tabId: string) => void;
  onClose: () => void;
}) {
  if (!tab) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-dim">
        Select a browser tab to inspect details and jump into its running workflow.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text">{tab.title || 'Browser Tab'}</h3>
            <p className="truncate text-xs text-text-dim">{tab.url || tab.domain || tab.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close browser tab details"
            className="inline-flex h-7 items-center justify-center rounded-md border border-border px-2 text-[11px] text-text-muted hover:bg-surface-hover"
          >
            Close
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${workbenchStatusPillClass(tab.status)}`}>{tab.status}</span>
          <span className="inline-flex rounded-full border border-border bg-bg px-2 py-0.5 text-text-dim">Tab {tab.id}</span>
          {tab.domain && tab.domain !== 'unknown' ? (
            <span className="inline-flex rounded-full border border-border bg-bg px-2 py-0.5 text-text-dim">{tab.domain}</span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-xs">
        <section className="rounded-lg border border-border bg-bg/40 p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">Tab Metadata</p>
          <dl className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">Title</dt>
              <dd className="mt-0.5 break-words text-text">{tab.title || 'n/a'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">URL</dt>
              <dd className="mt-0.5 break-words text-text">{tab.url || 'n/a'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">Last Used</dt>
              <dd className="mt-0.5 break-words text-text">{formatWorkbenchTime(tab.lastUsedAt)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">Last Updated</dt>
              <dd className="mt-0.5 break-words text-text">{formatWorkbenchTime(tab.lastUpdatedAt)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">Annotations</dt>
              <dd className="mt-0.5 break-words text-text">{tab.hasAnnotations ? 'Present' : 'None'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">Validation</dt>
              <dd className="mt-0.5 break-words text-text">{tab.validationSummary ? `${Math.round(tab.validationSummary.fitScore * 100)}% fit` : 'Not checked'}</dd>
            </div>
          </dl>
        </section>

        {tab.lastError ? (
          <section className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-red-700">Last Error</p>
            <p className="whitespace-pre-wrap break-words text-red-800">{tab.lastError}</p>
          </section>
        ) : null}

        <section className="rounded-lg border border-border bg-bg/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Linked Tasks</p>
            <button
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-[11px] text-text hover:bg-surface-hover"
            >
              Focus Tab
            </button>
          </div>
          {linkedTasks.length === 0 ? (
            <p className="text-text-dim">No browser workflow tasks are currently linked to this tab.</p>
          ) : (
            <div className="space-y-2">
              {linkedTasks.map((task) => (
                <div key={task.id} className="rounded-md border border-border bg-surface p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">{task.label}</p>
                      <p className="truncate text-[11px] text-text-dim">{task.stage}</p>
                    </div>
                    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${workbenchStatusPillClass(task.status as WorkbenchTab['status'])}`}>{task.status}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenTask(task.topLevelTaskId, tab.id)}
                      className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-[11px] text-text hover:bg-surface-hover"
                    >
                      Open Task View
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectTab(tab.id)}
                      className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-[11px] text-text hover:bg-surface-hover"
                    >
                      Focus Browser Tab
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
