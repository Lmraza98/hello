import type { ActionCapability, PageCapability } from './types';

class CapabilityRegistry {
  private pages: Map<string, PageCapability> = new Map();
  private listeners: Set<() => void> = new Set();

  register(page: PageCapability) {
    this.pages.set(page.pageId, page);
    this.notify();
  }

  unregister(pageId: string) {
    this.pages.delete(pageId);
    this.notify();
  }

  getPage(pageId: string): PageCapability | undefined {
    return this.pages.get(pageId);
  }

  getAllPages(): PageCapability[] {
    return Array.from(this.pages.values());
  }

  findAction(actionId: string): { page: PageCapability; action: ActionCapability } | undefined {
    for (const page of this.pages.values()) {
      const action = page.actions.find((a) => a.id === actionId || (Array.isArray(a.aliases) && a.aliases.includes(actionId)));
      if (action) return { page, action };
    }
    return undefined;
  }

  toJSON(): Record<string, PageCapability> {
    return Object.fromEntries(this.pages.entries());
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const capabilityRegistry = new CapabilityRegistry();
