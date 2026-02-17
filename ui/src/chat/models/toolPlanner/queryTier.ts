export type QueryTier = 'minimal' | 'standard' | 'full';

export function classifyQueryTier(userMessage: string): QueryTier {
  const lower = (userMessage || '').toLowerCase();

  if (/https?:\/\//.test(lower)) return 'full';
  if (/\btask=/.test(lower)) return 'full';
  if (/\b(like|similar\s+to|compared?\s+to)\b/.test(lower)) return 'full';

  const hasSalesNav = /\b(salesnav|sales\s*navigator|linkedin)\b/.test(lower);
  if (hasSalesNav) {
    const hasRecencyConstraint = /\b(last\s+\d+\s+(day|days|week|weeks|month|months|year|years)|recent|this\s+(week|month|year)|past\s+\d+\s+(day|days|week|weeks|month|months|year|years))\b/.test(lower);
    const hasRoleOrSignalConstraint = /\b(vp|vice president|director|head of|operations|publicly expressed|posted|interest in|interested in)\b/.test(lower);
    if (hasRecencyConstraint && hasRoleOrSignalConstraint) return 'full';
    if (/\b(browser|navigate|snapshot|click|screenshot|tab|type|fill|scroll|open|go\s+to)\b/.test(lower)) return 'full';
    if (/\bskill\b|\bworkflow\b/.test(lower)) return 'full';
    if (/\b(collect|scrape|harvest|bulk|discover|ingest)\b/.test(lower)) return 'standard';
    if (/\b(find|search|list|show|get)\b.*\b(companies|accounts|leads|people|contacts)\b/.test(lower)) return 'standard';
    return 'standard';
  }

  if (/\b(browser|navigate|snapshot|click|screenshot|skill|workflow|tab)\b/.test(lower)) return 'full';

  if (/\b(campaign|sequence|enroll)\b/.test(lower)) return 'standard';
  if (/\b(pipeline)\b/.test(lower)) return 'standard';
  if (/\b(salesforce|sfdc)\b/.test(lower)) return 'standard';
  if (/\b(further investigation|deeper investigation|dig deeper|continue investigation)\b/.test(lower)) return 'standard';

  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  const isSimpleLookup =
    /^\s*(find|search|show|get|lookup|look\s+up|display|view|who\s+is)\s+/i.test(lower) &&
    wordCount <= 8 &&
    !/\b(and|then|after|also|or)\b/.test(lower) &&
    !/\b(campaign|sequence|enroll|salesforce|sfdc|pipeline)\b/.test(lower);
  if (isSimpleLookup) return 'minimal';

  const isMutating = /\b(add|create|delete|remove|update|edit|start|stop|run|send|approve|reject|pause|activate|enroll|mark|import|bulk|scrape|collect|upload)\b/.test(lower);
  if (wordCount <= 4 && !isMutating) return 'minimal';

  return 'standard';
}
