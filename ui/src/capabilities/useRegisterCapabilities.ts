import { useEffect } from 'react';
import type { PageCapability } from './types';
import { capabilityRegistry } from './registry';

export function useRegisterCapabilities(capabilities: PageCapability | undefined) {
  useEffect(() => {
    if (!capabilities) return undefined;
    capabilityRegistry.register(capabilities);
    return () => capabilityRegistry.unregister(capabilities.pageId);
  }, [capabilities]);
}
