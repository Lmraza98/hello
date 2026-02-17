import rawCapabilities from './source.json';
import type { PageCapability } from './types';

export const PAGE_CAPABILITIES = rawCapabilities as PageCapability[];

const BY_ID = new Map<string, PageCapability>(
  PAGE_CAPABILITIES.map((page) => [page.pageId, page])
);

export function getPageCapability(pageId: string): PageCapability | undefined {
  return BY_ID.get(pageId);
}
