import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

export type WorkspaceMode = 'drawer' | 'fullscreen';
export type WorkspaceSource = 'sidebar' | 'chat' | 'system';

export interface WorkspaceLayoutState {
  open: boolean;
  mode: WorkspaceMode;
  source: WorkspaceSource;
  drawerWidth: number;
  activeRoute: string;
  interaction: WorkspaceInteractionState | null;
}

export interface WorkspaceEnsureOptions {
  source?: WorkspaceSource;
  preferredMode?: WorkspaceMode;
}

export interface WorkspaceModeOptions {
  persistForRoute?: string;
}

export interface WorkspaceLayoutApi extends WorkspaceLayoutState {
  openWorkspace: (options?: WorkspaceEnsureOptions) => void;
  closeWorkspace: () => void;
  setWorkspaceMode: (mode: WorkspaceMode, options?: WorkspaceModeOptions) => void;
  setWorkspaceSource: (source: WorkspaceSource) => void;
  ensureVisibleForRoute: (route: string, options?: WorkspaceEnsureOptions) => void;
  setDrawerWidth: (width: number) => void;
  signalInteraction: (kind: WorkspaceInteractionKind, label: string, options?: WorkspaceInteractionOptions) => void;
  clearInteraction: () => void;
}

export type WorkspaceInteractionKind = 'navigation' | 'filter' | 'workflow' | 'selection';

export interface WorkspaceInteractionOptions {
  source?: WorkspaceSource;
  route?: string;
  summary?: string;
  chips?: string[];
  openWorkspace?: boolean;
  status?: WorkspaceInteractionStatus;
  resultLabel?: string;
  resultCount?: number;
  createContactPrefill?: WorkspaceCreateContactPrefill;
  missingFields?: string[];
}

export type WorkspaceInteractionStatus = 'in_progress' | 'success' | 'failed';

export interface WorkspaceCreateContactPrefill {
  name?: string;
  email?: string;
  phone?: string;
  company_name?: string;
  title?: string;
}

export interface WorkspaceInteractionState {
  id: number;
  kind: WorkspaceInteractionKind;
  label: string;
  summary?: string;
  route?: string;
  chips: string[];
  status: WorkspaceInteractionStatus;
  resultLabel?: string;
  resultCount?: number;
  createContactPrefill?: WorkspaceCreateContactPrefill;
  missingFields: string[];
  startedAt: number;
}

const DEFAULT_DRAWER_WIDTH = 900;
const MIN_DRAWER_WIDTH = 520;
const MAX_DRAWER_WIDTH = 1400;
const STORAGE_OPEN_KEY = 'hello_workspace_open_v1';
const STORAGE_WIDTH_KEY = 'hello_workspace_width_v1';
const STORAGE_ROUTE_MODE_KEY = 'hello_workspace_route_modes_v1';

function clampWidth(width: number): number {
  return Math.max(MIN_DRAWER_WIDTH, Math.min(MAX_DRAWER_WIDTH, Math.round(width)));
}

function parseBooleanStorage(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  return fallback;
}

function parseNumberStorage(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clampWidth(parsed);
}

function routeClassKey(route: string): string {
  if (route.startsWith('/browser')) return 'browser';
  return 'default';
}

function parseRouteModeMap(raw: string | null): Record<string, WorkspaceMode> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, WorkspaceMode> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'drawer' || v === 'fullscreen') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function routeClassForPath(route: string): string {
  return routeClassKey(route);
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutApi | undefined>(undefined);

export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [open, setOpen] = useState(() => parseBooleanStorage(localStorage.getItem(STORAGE_OPEN_KEY), false));
  const [source, setSource] = useState<WorkspaceSource>('system');
  const [drawerWidth, setDrawerWidthState] = useState(() => parseNumberStorage(localStorage.getItem(STORAGE_WIDTH_KEY), DEFAULT_DRAWER_WIDTH));
  const [routeModes, setRouteModes] = useState<Record<string, WorkspaceMode>>(() =>
    parseRouteModeMap(localStorage.getItem(STORAGE_ROUTE_MODE_KEY))
  );
  const [interaction, setInteraction] = useState<WorkspaceInteractionState | null>(null);

  const activeRoute = location.pathname;
  const routeKey = routeClassKey(activeRoute);
  const mode = routeModes[routeKey] || 'drawer';

  useEffect(() => {
    localStorage.setItem(STORAGE_OPEN_KEY, open ? '1' : '0');
  }, [open]);

  useEffect(() => {
    localStorage.setItem(STORAGE_WIDTH_KEY, String(drawerWidth));
  }, [drawerWidth]);

  useEffect(() => {
    localStorage.setItem(STORAGE_ROUTE_MODE_KEY, JSON.stringify(routeModes));
  }, [routeModes]);

  useEffect(() => {
    if (activeRoute !== '/dashboard' && activeRoute !== '/') {
      setOpen(true);
    }
  }, [activeRoute]);

  const setWorkspaceMode = useCallback(
    (nextMode: WorkspaceMode, options?: WorkspaceModeOptions) => {
      const key = routeClassKey(options?.persistForRoute || activeRoute);
      setRouteModes((prev) => {
        if (prev[key] === nextMode) return prev;
        return { ...prev, [key]: nextMode };
      });
    },
    [activeRoute]
  );

  const setWorkspaceSource = useCallback((nextSource: WorkspaceSource) => {
    setSource(nextSource);
  }, []);

  const setDrawerWidth = useCallback((width: number) => {
    setDrawerWidthState(clampWidth(width));
  }, []);

  const openWorkspace = useCallback(
    (options?: WorkspaceEnsureOptions) => {
      if (options?.source) {
        setSource(options.source);
        if (options.source !== 'chat') setInteraction(null);
      }
      if (options?.preferredMode) {
        setWorkspaceMode(options.preferredMode);
      }
      setOpen(true);
    },
    [setWorkspaceMode]
  );

  const closeWorkspace = useCallback(() => {
    setOpen(false);
  }, []);

  const ensureVisibleForRoute = useCallback(
    (route: string, options?: WorkspaceEnsureOptions) => {
      if (options?.source) {
        setSource(options.source);
        if (options.source !== 'chat') setInteraction(null);
      }
      if (options?.preferredMode) {
        setWorkspaceMode(options.preferredMode, { persistForRoute: route });
      }
      setOpen(true);
    },
    [setWorkspaceMode]
  );

  const signalInteraction = useCallback((kind: WorkspaceInteractionKind, label: string, options?: WorkspaceInteractionOptions) => {
    if (options?.source) setSource(options.source);
    setInteraction({
      id: Date.now(),
      kind,
      label: label.trim() || 'Updating workspace',
      summary: options?.summary?.trim() || undefined,
      route: options?.route,
      chips: (options?.chips || []).filter(Boolean).slice(0, 8),
      status: options?.status || 'in_progress',
      resultLabel: options?.resultLabel,
      resultCount: options?.resultCount,
      createContactPrefill: options?.createContactPrefill,
      missingFields: (options?.missingFields || []).filter(Boolean).slice(0, 8),
      startedAt: Date.now(),
    });
    if (options?.openWorkspace ?? true) {
      setOpen(true);
    }
  }, []);

  const clearInteraction = useCallback(() => {
    setInteraction(null);
  }, []);

  const value = useMemo<WorkspaceLayoutApi>(
    () => ({
      open,
      mode,
      source,
      drawerWidth,
      activeRoute,
      interaction,
      openWorkspace,
      closeWorkspace,
      setWorkspaceMode,
      setWorkspaceSource,
      ensureVisibleForRoute,
      setDrawerWidth,
      signalInteraction,
      clearInteraction,
    }),
    [
      open,
      mode,
      source,
      drawerWidth,
      activeRoute,
      interaction,
      openWorkspace,
      closeWorkspace,
      setWorkspaceMode,
      setWorkspaceSource,
      ensureVisibleForRoute,
      setDrawerWidth,
      signalInteraction,
      clearInteraction,
    ]
  );

  return <WorkspaceLayoutContext.Provider value={value}>{children}</WorkspaceLayoutContext.Provider>;
}

export function useWorkspaceLayout() {
  const context = useContext(WorkspaceLayoutContext);
  if (!context) throw new Error('useWorkspaceLayout must be used inside WorkspaceLayoutProvider');
  return context;
}
