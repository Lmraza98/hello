export type PlannerModelName = 'gemma' | 'gpt-4o-mini' | 'gpt-4o' | 'claude-sonnet';

export interface ComplexityAssessment {
  level: 'simple' | 'moderate' | 'complex';
  signals: string[];
  recommendedModel: PlannerModelName;
  compoundWorkflowRequired: boolean;
}

export interface ComplexityContext {
  requiresDecomposition?: boolean;
  isRetry?: boolean;
}

const COMPLEX_PATTERNS: RegExp[] = [
  /\b(and then|after that|finally|next)\b/i,
  /\b(for each|for all|every)\b/i,
  /\b(sales\s*navigator|linkedin|scrape|crawl|browse|on the web)\b/i,
  /\b(that are|who have|which have|that have).+(and|who also|that also)\b/i,
  /\b(last \d+ (days?|weeks?|months?)|recent(ly)?|this (week|month|year))\b/i,
  /\b(generate .+ for each|create .+ for all|email sequence|campaign for)\b/i,
  /\b(find|identify|get) \d+ .+ (that|who|which)\b/i,
  /\b(further investigation|deeper investigation|dig deeper|continue investigation)\b/i,
];

const SIMPLE_PATTERNS: RegExp[] = [
  /^(go to|show me|open|navigate to) (the )?[\w\s]+( page)?$/i,
  /^who is .+$/i,
  /^(show|get|find) .+ (info|details|information)$/i,
  /^(list|show) (my )?(campaigns|contacts|companies)$/i,
];

export function assessComplexity(query: string, context: ComplexityContext = {}): ComplexityAssessment {
  const normalized = (query || '').trim();
  const signals: string[] = [];
  let compoundWorkflowRequired = false;
  const lower = normalized.toLowerCase();

  if (context.requiresDecomposition) {
    signals.push('requires_decomposition');
  }
  if (context.isRetry) {
    signals.push('retry_mode');
  }

  for (const pattern of SIMPLE_PATTERNS) {
    if (signals.length === 0 && pattern.test(normalized)) {
      return { level: 'simple', signals: ['matches_simple_pattern'], recommendedModel: 'gemma', compoundWorkflowRequired: false };
    }
  }

  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(normalized)) {
      signals.push(`matches_complex_pattern:${pattern.source.slice(0, 24)}`);
    }
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 30) signals.push(`high_word_count:${wordCount}`);

  const entityMentions = (normalized.match(/\b(companies|contacts|campaigns|emails)\b/gi) || []).length;
  if (entityMentions > 2) signals.push(`multiple_entity_types:${entityMentions}`);

  if (
    /\b(for each|for all|every|identify \d+|find \d+)\b/i.test(normalized) &&
    /\b(linkedin|sales\s*navigator|salesnav)\b/i.test(normalized) &&
    /\b(last \d+ (days?|weeks?|months?)|recent|posted|publicly expressed|interested)\b/i.test(normalized)
  ) {
    compoundWorkflowRequired = true;
    signals.push('compound_workflow_required');
  }

  // High-priority routing heuristics:
  // - Sales Navigator / LinkedIn workflows are typically multi-step and tool-heavy.
  // - Compound criteria with conjunctions tend to require stronger planning.
  const mentionsSalesNav = /\b(sales\s*navigator|salesnav|linkedin)\b/i.test(normalized);
  const hasCompoundJoin = /\b(and|with|plus)\b/i.test(normalized);
  const hasCriteriaPhrase = /\b(that are|who have|which have|that have)\b/i.test(normalized);
  if (mentionsSalesNav) {
    signals.push('salesnav_or_linkedin');
  }
  if (hasCompoundJoin && (hasCriteriaPhrase || /\b(vp|director|industry|sector|posted)\b/i.test(normalized))) {
    signals.push('compound_criteria');
  }

  if (mentionsSalesNav || signals.includes('compound_criteria')) {
    const level = compoundWorkflowRequired ? 'complex' : 'moderate';
    return { level, signals, recommendedModel: 'gpt-4o-mini', compoundWorkflowRequired };
  }

  if (signals.length >= 2) return { level: 'complex', signals, recommendedModel: 'gpt-4o-mini', compoundWorkflowRequired };
  if (signals.length === 1) return { level: 'moderate', signals, recommendedModel: 'gemma', compoundWorkflowRequired };
  return { level: 'simple', signals: ['no_complexity_signals'], recommendedModel: 'gemma', compoundWorkflowRequired };
}
