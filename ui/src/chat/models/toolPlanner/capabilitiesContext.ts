import capabilitiesRegistry from '../../../capabilities/generated/registry.json';

type CapabilityPage = {
  pageId?: string;
  title?: string;
  route?: string;
  actions?: Array<{ id?: string }>;
};

function summarizeRegistry(pages: CapabilityPage[]): string {
  const pageEntries = pages.slice(0, 8).map((page) => {
    const pageId = page.pageId || 'unknown';
    const title = page.title || pageId;
    const route = page.route || '/';
    const actions = Array.isArray(page.actions) ? page.actions.slice(0, 10).map((action) => action.id || '').filter(Boolean) : [];
    return [`### ${title} (\`${route}\`)`, `Actions: ${actions.length > 0 ? actions.join(', ') : 'none'}`].join('\n');
  });
  const assistantGuide = [
    '### Assistant Guidance Overlay',
    'Actions: assistant_ui_start_flow, assistant_ui_set_target, assistant_ui_clear',
    'assistant_ui_start_flow shape: {"type":"assistant_ui_start_flow","flowId":"create_contact"}',
    'assistant_ui_set_target shape: {"type":"assistant_ui_set_target","targetId":"new-contact-button","scrollTargetId":"new-contact-button","instruction":"Click New Contact","interaction":"click","pointerMode":"passthrough","autoClick":false}',
    'Legacy assistant_guide / assistant_guide_clear are still accepted as aliases.',
    'Use assistant_ui_start_flow for durable multi-step UI orchestration that should resume on session return.',
    'Prefer click demonstration without activation for walkthroughs; only set autoClick=true when the user explicitly wants the assistant to perform the click.',
    'Use pointerMode="passthrough" for live click-through targets and pointerMode="interactive" for panel/form guidance where chat scrolling must remain active.',
    'Known target ids: new-contact-button, export-contacts-button, contact-create-panel, contact-name-input, contact-company-input, contact-email-input, contact-phone-input, contact-location-input, contact-title-input, contact-linkedin-input, contact-salesforce-input, add-contact-submit',
  ].join('\n');
  return ['# UI Capabilities (Relevant Summary)', '', ...pageEntries, assistantGuide].join('\n\n');
}

function scorePage(page: CapabilityPage, query: string): number {
  const q = query.toLowerCase();
  const hay = [
    String(page.pageId || ''),
    String(page.title || ''),
    String(page.route || ''),
    ...(Array.isArray(page.actions) ? page.actions.map((a) => String(a.id || '')) : []),
  ].join(' ').toLowerCase();
  if (!q.trim()) return 0;
  let score = 0;
  for (const token of q.split(/\s+/).filter((x) => x.length >= 3)) {
    if (hay.includes(token)) score += 2;
  }
  if (q.includes('campaign') && hay.includes('email')) score += 4;
  if (q.includes('email') && hay.includes('email')) score += 3;
  if (q.includes('contact') && hay.includes('contact')) score += 3;
  if (q.includes('compan') && hay.includes('compan')) score += 3;
  if (q.includes('task') && hay.includes('task')) score += 3;
  return score;
}

function pickRelevantPages(pages: CapabilityPage[], query: string): CapabilityPage[] {
  const scored = pages
    .map((page) => ({ page, score: scorePage(page, query) }))
    .sort((a, b) => b.score - a.score);
  const top = scored.filter((row) => row.score > 0).slice(0, 6).map((row) => row.page);
  if (top.length >= 3) return top;
  // Fallback to include high-value navigation pages.
  const defaults = pages.filter((page) =>
    ['dashboard', 'companies', 'contacts', 'email.campaigns', 'tasks'].includes(String(page.pageId || ''))
  );
  return [...top, ...defaults].slice(0, 8);
}

export interface CapabilityPromptContext {
  block: string;
  loaded: boolean;
  source: 'registry_summary' | 'none';
  sourcePath: string;
  pageCount: number;
  actionCount: number;
}

export function getCapabilityPromptContext(query = ''): CapabilityPromptContext {
  const pages = Array.isArray(capabilitiesRegistry) ? (capabilitiesRegistry as CapabilityPage[]) : [];
  const pageCount = pages.length;
  const actionCount = pages.reduce((sum, page) => sum + (Array.isArray(page.actions) ? page.actions.length : 0), 0);

  if (pageCount > 0) {
    const relevantPages = pickRelevantPages(pages, query);
    return {
      block: summarizeRegistry(relevantPages),
      loaded: true,
      source: 'registry_summary',
      sourcePath: 'ui/src/capabilities/generated/registry.json',
      pageCount,
      actionCount,
    };
  }

  return {
    block: '',
    loaded: false,
    source: 'none',
    sourcePath: 'none',
    pageCount: 0,
    actionCount: 0,
  };
}
