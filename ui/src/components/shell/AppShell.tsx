import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChatFirstShell } from './ChatFirstShell';
import { LegacySplitShell } from './LegacySplitShell';
export { useAppShellContext } from './appShellContext';

const STORAGE_KEY = 'hello_feature_chat_first_shell';
const FEATURE_EVENT = 'hello:feature-flags-changed';

function parseOverride(raw: string | null): boolean | null {
  if (raw == null) return null;
  if (raw === 'on' || raw === 'true' || raw === '1') return true;
  if (raw === 'off' || raw === 'false' || raw === '0') return false;
  return null;
}

function readFeatureFlag(): boolean {
  const envRaw = String(import.meta.env.VITE_CHAT_FIRST_SHELL ?? 'true').toLowerCase();
  const envDefault = envRaw !== 'false' && envRaw !== '0' && envRaw !== 'off';
  const override = parseOverride(localStorage.getItem(STORAGE_KEY));
  if (override == null) return envDefault;
  return override;
}

export function AppShell() {
  const location = useLocation();
  const [chatFirstEnabled, setChatFirstEnabled] = useState(() => readFeatureFlag());

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setChatFirstEnabled(readFeatureFlag());
    };
    const onFeatureEvent = () => setChatFirstEnabled(readFeatureFlag());
    window.addEventListener('storage', onStorage);
    window.addEventListener(FEATURE_EVENT, onFeatureEvent);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(FEATURE_EVENT, onFeatureEvent);
    };
  }, []);

  const queryForcesLegacy = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('legacyShell') === '1';
  }, [location.search]);

  if (!chatFirstEnabled || queryForcesLegacy) {
    return <LegacySplitShell />;
  }

  return <ChatFirstShell />;
}
