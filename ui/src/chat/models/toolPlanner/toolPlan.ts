import type { ParsedToolCall } from '../../toolExecutor';
import type { ChatAction } from '../../actions';
import type { LocalChatMessage } from '../ollamaClient';
import { createPlannerAskFn, type PlannerRoute } from '../plannerBackends';
import { appendTokenStreamChunk, finalizeTokenStream, resetTokenStream } from '../../../services/chatRunLog';
import { buildPlannerExamplesBlock } from '../../toolExamples';
import { withTimeout } from './timeout';
import { classifyQueryTier, type QueryTier } from './queryTier';
import { selectToolsForMessage } from './toolSelection';
import { buildToolSchemaBlock, buildTieredSystemPrompt } from './prompt';
import { getFilterContextBlock } from './filterContext';
import { runAuxPlannerFallback, isLikelyReadOnlyRequest } from './auxFallback';
import { stripPlannerHeuristicContext } from './sessionBlocks';
import { extractCandidateJson, normalizeParsedPlan, shouldUpgradeModelAfterParseFailure } from './parse';
import { buildPlanRationale, normalizePlannedCalls } from './normalize';
import { ENABLE_PLAN_COVERAGE_AUDIT, TOOL_PLANNER_TIMEOUT_MS } from './config';
import { getCapabilityPromptContext } from './capabilitiesContext';
import { assessComplexity } from './complexityClassifier';
import type { PlannerModelName } from './complexityClassifier';
import { ACTIVE_MODEL_CONFIG, MODEL_ID_HINTS, MODEL_PROVIDER_HINTS } from '../../../config/plannerConfig';

export interface ToolPlanResult {
  success: boolean;
  plannedCalls: ParsedToolCall[];
  plannedUiActions: ChatAction[];
  selectedTools: string[];
  rawContent: string | null;
  planRationale: string[];
  constraintWarnings: string[];
  constraintRisk?: 'low' | 'medium' | 'high';
  failureReason?: string;
  clarificationQuestion?: string;
}

export interface RunToolPlanOptions {
  quick?: boolean;
  onToken?: (token: string) => void;
  requiresDecomposition?: boolean;
  isRetry?: boolean;
  plannerRouteOverride?: PlannerRoute;
}

interface CoverageAudit {
  missing_constraints: string[];
  risk: 'low' | 'medium' | 'high';
  explanation?: string;
}

interface CompoundQueryHints {
  maxResults: number;
  recencyMonths: number;
  country: string;
  companyQuery: string;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function extractCompoundQueryHints(query: string): CompoundQueryHints {
  const cleaned = (query || '').trim();

  const countMatch = cleaned.match(/\b(?:identify|find|get|list)\s+(\d{1,3})\b/i);
  const requestedCount = countMatch ? Number(countMatch[1]) : 10;
  const maxResults = clampNumber(Number.isFinite(requestedCount) ? requestedCount : 10, 1, 50);

  const monthsMatch = cleaned.match(/\blast\s+(\d{1,2})\s+months?\b/i);
  const recencyMonths = clampNumber(monthsMatch ? Number(monthsMatch[1]) : 6, 1, 24);

  const country =
    /\b(united states|u\.s\.|usa|us-based)\b/i.test(cleaned) ? 'United States' : 'United States';

  const hasIndustrialMachinery = /\bindustrial machinery\b/i.test(cleaned);
  const hasSalesforce = /\bsalesforce\b/i.test(cleaned);
  const companyTerms = [
    hasIndustrialMachinery ? 'industrial machinery' : '',
    /\bmanufacturing\b/i.test(cleaned) ? 'manufacturing' : '',
    hasSalesforce ? 'salesforce' : '',
    /\bhealthcare\b/i.test(cleaned) ? 'healthcare' : '',
  ].filter((v) => v.length > 0);
  const companyQuery = companyTerms.length > 0 ? Array.from(new Set(companyTerms)).join(' ') : cleaned;

  return {
    maxResults,
    recencyMonths,
    country,
    companyQuery,
  };
}

export function buildCompoundWorkflowSpecFromQuery(query: string): Record<string, unknown> {
  const cleaned = (query || '').trim();
  const hints = extractCompoundQueryHints(cleaned);
  const derivedName = cleaned
    ? (cleaned.length > 90 ? `${cleaned.slice(0, 87)}...` : cleaned)
    : 'Compound Lead Qualification Workflow';
  const phaseOneFilters: Record<string, string> = {
    headquarters_location: hints.country,
  };
  return {
    name: derivedName,
    description: cleaned || 'Multi-phase browser workflow for compound lead qualification.',
    constraints: {
      max_results: hints.maxResults,
      max_runtime_minutes: 45,
      max_browser_calls: clampNumber(hints.maxResults * 22, 120, 260),
      concurrency: 3,
    },
    original_query: cleaned,
    phases: [
      {
        id: 'phase_1_search_companies',
        name: 'Search target companies on Sales Navigator',
        type: 'search',
        operation: {
          tool: 'browser_search_and_extract',
          task: 'salesnav_search_account',
          base_params: { limit: 80 },
        },
        param_templates: {
          query: cleaned || hints.companyQuery || 'industrial machinery manufacturing salesforce',
          filters: phaseOneFilters,
        },
        post_process: { limit: 40 },
        checkpoint: {
          enabled: true,
          message: 'Found {{count}} companies. Continue with VP of Operations enrichment?',
          auto_continue_if: 'count <= 20',
        },
      },
      {
        id: 'phase_2_find_vp_ops',
        name: 'Find VP of Operations candidates',
        type: 'enrich',
        operation: {
          tool: 'browser_search_and_extract',
          task: 'salesnav_people_search',
          base_params: { limit: 8 },
        },
        iteration: {
          over: 'phase_1_search_companies.results',
          as: 'company',
          max_items: 30,
          concurrency: 3,
        },
        param_templates: {
          query: '',
          filters: {
            current_company: '{{company.name}}',
            current_company_sales_nav_url: '{{company.sales_nav_url}}',
            headquarters_location: hints.country,
            function: 'Operations',
            seniority_level: 'Vice President',
          },
        },
        post_process: {
          filter: "\"vp\" in (result.get('title','') or '').lower() or \"operations\" in (result.get('title','') or '').lower()",
          limit: 50,
        },
        depends_on: ['phase_1_search_companies'],
      },
      {
        id: 'phase_3_verify_recent_ai_signal',
        name: 'Verify recent AI/process optimization interest',
        type: 'verify',
        operation: {
          tool: 'browser_search_and_extract',
          task: 'salesnav_people_search',
          base_params: { limit: 5 },
        },
        iteration: {
          over: 'phase_2_find_vp_ops.results',
          as: 'vp',
          max_items: 40,
          concurrency: 2,
        },
        param_templates: {
          query: '',
          filters: {
            current_company: '{{vp.company_name}}',
            current_company_sales_nav_url: '{{vp.company_sales_nav_url}}',
            headquarters_location: hints.country,
            function: 'Operations',
            seniority_level: 'Vice President',
          },
        },
        post_process: {
          limit: 20,
        },
        checkpoint: {
          enabled: true,
          message: 'Verified {{count}} candidates with AI/process signals. Continue to final ranking?',
          auto_continue_if: 'count <= 12',
        },
        depends_on: ['phase_2_find_vp_ops'],
      },
      {
        id: 'phase_4_aggregate',
        name: 'Aggregate and rank final targets',
        type: 'aggregate',
        operation: {
          tool: 'internal_aggregate',
          task: 'join_and_rank',
        },
        param_templates: {
          rank_by: 'score',
          limit: 10,
        },
        depends_on: ['phase_3_verify_recent_ai_signal'],
      },
    ],
  };
}

function buildLinkedInVerificationFallbackCalls(selectionMessage: string): ParsedToolCall[] {
  const accountQuery = 'industrial machinery manufacturers united states salesforce';
  const peopleQuery = 'VP of Operations AI process optimization industrial machinery united states';
  const mergedQuery = selectionMessage && selectionMessage.trim().length > 0 ? selectionMessage.trim() : peopleQuery;
  return [
    {
      name: 'browser_search_and_extract',
      args: {
        task: 'salesnav_search_account',
        query: accountQuery,
        filters: {
          headquarters_location: 'United States',
        },
        limit: 80,
      },
    },
    {
      name: 'browser_list_sub_items',
      args: {
        task: 'salesnav_list_employees',
        parent_query: accountQuery,
        parent_task: 'salesnav_search_account',
        entrypoint_action: 'entrypoint',
        extract_type: 'lead',
        limit: 80,
      },
    },
    {
      name: 'browser_search_and_extract',
      args: {
        task: 'salesnav_people_search',
        query: mergedQuery || peopleQuery,
        filters: {
          headquarters_location: 'United States',
          function: 'Operations',
          seniority_level: 'Vice President',
        },
        limit: 60,
      },
    },
  ];
}

function resolvePlannerRoute(
  selectionMessage: string,
  options: RunToolPlanOptions
): { route: PlannerRoute; modelName: PlannerModelName; profile: 'gemma' | 'strong'; complexity: ReturnType<typeof assessComplexity> } {
  const complexity = assessComplexity(selectionMessage, {
    requiresDecomposition: options.requiresDecomposition,
    isRetry: options.isRetry,
  });
  const modelName: PlannerModelName =
    options.requiresDecomposition
      ? ACTIVE_MODEL_CONFIG.decomposition
      : (complexity.recommendedModel === 'gemma' ? ACTIVE_MODEL_CONFIG.simple : ACTIVE_MODEL_CONFIG.complex);
  const provider = MODEL_PROVIDER_HINTS[modelName];
  const model = MODEL_ID_HINTS[modelName];
  return {
    route: { provider, model },
    modelName,
    profile: modelName === 'gemma' ? 'gemma' : 'strong',
    complexity,
  };
}

export async function runToolPlan(
  userMessage: string,
  conversationHistory: LocalChatMessage[],
  onProgress?: (message: string) => void,
  allowedToolNames?: readonly string[],
  options: RunToolPlanOptions = {}
): Promise<ToolPlanResult> {
  const emit = (message: string) => onProgress?.(message);
  const startedAt = Date.now();
  const quickMode = options.quick === true;
  const selectionMessage = stripPlannerHeuristicContext(userMessage);

  const naturalTier = classifyQueryTier(selectionMessage);
  const tier: QueryTier = naturalTier;
  emit(`Query tier: ${tier}${quickMode ? ' (quick mode)' : ''}.`);
  const plannerRoute = resolvePlannerRoute(selectionMessage, options);
  if (options.plannerRouteOverride?.model || options.plannerRouteOverride?.provider || options.plannerRouteOverride?.backend) {
    plannerRoute.route = {
      ...plannerRoute.route,
      ...options.plannerRouteOverride,
    };
    emit(`Planner override applied: provider=${plannerRoute.route.provider} model=${plannerRoute.route.model}.`);
  }
  emit(
    `Complexity assessment: ${plannerRoute.complexity.level} (${plannerRoute.complexity.signals.join(', ') || 'none'}).`
  );
  if (plannerRoute.complexity.compoundWorkflowRequired) {
    emit('Compound workflow required for this query structure.');
  }
  emit(`Planner model route: provider=${plannerRoute.route.provider} model=${plannerRoute.route.model}.`);

  const selectedToolDefs = selectToolsForMessage(userMessage, allowedToolNames, tier);
  const selectedTools = selectedToolDefs.map((t) => t.function.name);
  emit(`Loaded ${selectedTools.length} tools for planning (tier=${tier}).`);

  const schemaBlock = buildToolSchemaBlock(selectedToolDefs);
  const examplesBlock = tier === 'full' ? buildPlannerExamplesBlock(selectedToolDefs, 3) : '';
  const filterContextBlock = tier === 'full' ? getFilterContextBlock() : '';
  const capabilityContext = getCapabilityPromptContext(selectionMessage);
  const capabilityPromptCap = tier === 'full' ? 5000 : 2000;
  const capabilityContextBlock = capabilityContext.block
    ? capabilityContext.block.slice(0, capabilityPromptCap)
    : '';
  emit(
    `Capabilities context loaded=${capabilityContext.loaded} source=${capabilityContext.source} path=${capabilityContext.sourcePath} pages=${capabilityContext.pageCount} actions=${capabilityContext.actionCount}.`
  );

  const systemPrompt = buildTieredSystemPrompt(tier, schemaBlock, {
    examplesBlock,
    filterContextBlock,
    capabilityContextBlock,
    modelProfile: plannerRoute.profile,
  });

  const historySlice = tier === 'minimal' ? 2 : tier === 'standard' ? (quickMode ? 2 : 4) : (quickMode ? 6 : 8);
  const messages: LocalChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-historySlice),
    { role: 'user', content: userMessage },
  ];

  let activeRoute = plannerRoute.route;
  let activeModelName = plannerRoute.modelName;
  let askPlanner = createPlannerAskFn(activeRoute);
  const externalOnToken = options.onToken;
  const streamTokens = (token: string) => {
    appendTokenStreamChunk(token);
    externalOnToken?.(token);
  };
  const ask = async (extraInstruction?: string, signal?: AbortSignal): Promise<{ content: string | null }> => {
    resetTokenStream();
    const finalMessages: LocalChatMessage[] = extraInstruction
      ? [...messages, { role: 'user', content: extraInstruction } as LocalChatMessage]
      : messages;
    const result = await askPlanner(finalMessages, { signal, onToken: streamTokens });
    finalizeTokenStream();
    return result;
  };

  const upgradePlannerIfNeeded = (reason: string): boolean => {
    if (!shouldUpgradeModelAfterParseFailure(activeRoute.model)) return false;
    if (activeModelName !== ACTIVE_MODEL_CONFIG.simple) return false;
    activeModelName = ACTIVE_MODEL_CONFIG.complex;
    activeRoute = {
      provider: MODEL_PROVIDER_HINTS[activeModelName],
      model: MODEL_ID_HINTS[activeModelName],
    };
    askPlanner = createPlannerAskFn(activeRoute);
    emit(`Upgraded planner model for ${reason}: provider=${activeRoute.provider} model=${activeRoute.model}.`);
    return true;
  };

  let rawContent: string | null = null;
  let calls: ParsedToolCall[] = [];
  let uiActions: ChatAction[] = [];
  let recoveredByLocalRetry = false;
  const fastFailJsonRecovery = isLikelyReadOnlyRequest(selectionMessage);

  try {
    emit('Requesting initial tool plan from model...');
    const initialStartedAt = Date.now();
    const controller = new AbortController();
    const first = await withTimeout(
      ask(undefined, controller.signal),
      TOOL_PLANNER_TIMEOUT_MS,
      'initial',
      () => controller.abort()
    );
    emit(`Initial planner response in ${Date.now() - initialStartedAt}ms.`);
    rawContent = first.content;
    emit('Initial response received. Parsing JSON...');
    const candidate = extractCandidateJson(first.content);
    if (candidate) {
      const parsed = normalizeParsedPlan(JSON.parse(candidate));
      calls = parsed.toolCalls;
      uiActions = parsed.uiActions;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_error';
    emit(`Planner failed in ${Date.now() - startedAt}ms (${reason}).`);
    if (activeRoute.provider === 'openai' || activeRoute.provider === 'openrouter') {
      try {
        emit('Hosted planner failed. Retrying with local planner backend...');
        activeModelName = ACTIVE_MODEL_CONFIG.simple;
        activeRoute = {
          provider: 'ollama',
          model: MODEL_ID_HINTS[activeModelName],
        };
        askPlanner = createPlannerAskFn(activeRoute);
        const localStartedAt = Date.now();
        const controller = new AbortController();
        const local = await withTimeout(
          ask(undefined, controller.signal),
          TOOL_PLANNER_TIMEOUT_MS,
          'local_retry_after_hosted_failure',
          () => controller.abort()
        );
        emit(`Local retry response in ${Date.now() - localStartedAt}ms.`);
        rawContent = local.content;
        const candidate = extractCandidateJson(local.content);
        if (candidate) {
          const parsed = normalizeParsedPlan(JSON.parse(candidate));
          calls = parsed.toolCalls;
          uiActions = parsed.uiActions;
          recoveredByLocalRetry = calls.length > 0 || uiActions.length > 0;
        }
      } catch {
        // Fall through to existing tier/fallback behavior.
      }
    }
    if (!recoveredByLocalRetry) {
      if (tier === 'minimal') {
        return {
          success: false,
          plannedCalls: [],
          plannedUiActions: [],
          selectedTools,
          rawContent,
          planRationale: [],
          constraintWarnings: [],
          failureReason: `planner_minimal_error:${reason}`,
        };
      }
      const aux = await runAuxPlannerFallback(selectionMessage, conversationHistory, schemaBlock, emit);
      if (aux.calls.length > 0) {
        rawContent = aux.rawContent || rawContent;
        calls = aux.calls;
      } else {
        return {
          success: false,
          plannedCalls: [],
          plannedUiActions: [],
          selectedTools,
          rawContent,
          planRationale: [],
          constraintWarnings: [],
          failureReason: `planner_request_error_or_timeout:${reason}`,
        };
      }
    }
  }

  if (calls.length === 0 && uiActions.length === 0) {
    if (upgradePlannerIfNeeded('parse failure')) {
      try {
        emit('Re-running plan with upgraded model...');
        const upgradeStartedAt = Date.now();
        const controller = new AbortController();
        const retry = await withTimeout(
          ask(
            `You MUST return valid JSON with keys ui_actions and tool_calls. ` +
            `Choose at least one action when the task is supported.`,
            controller.signal
          ),
          TOOL_PLANNER_TIMEOUT_MS,
          'model_upgrade_retry',
          () => controller.abort()
        );
        emit(`Upgraded-model response in ${Date.now() - upgradeStartedAt}ms.`);
        rawContent = retry.content;
        const candidate = extractCandidateJson(retry.content);
        if (candidate) {
          const parsed = normalizeParsedPlan(JSON.parse(candidate));
          calls = parsed.toolCalls;
          uiActions = parsed.uiActions;
        }
      } catch {
        // Continue to existing retry/fallback flow.
      }
    }
  }

  if (calls.length === 0 && uiActions.length === 0) {
    if (tier === 'minimal') {
      emit(`Quick/minimal mode: no retry. Planning failed in ${Date.now() - startedAt}ms.`);
      return {
        success: false,
        plannedCalls: [],
        plannedUiActions: [],
        selectedTools,
        rawContent,
        planRationale: [],
        constraintWarnings: [],
        failureReason: 'quick_mode_no_valid_calls',
      };
    }

    if (tier === 'standard' || fastFailJsonRecovery) {
      const aux = await runAuxPlannerFallback(selectionMessage, conversationHistory, schemaBlock, emit);
      if (aux.calls.length > 0) {
        rawContent = aux.rawContent || rawContent;
        calls = aux.calls;
      } else {
        emit(`Planning failed in ${Date.now() - startedAt}ms.`);
        return {
          success: false,
          plannedCalls: [],
          plannedUiActions: [],
          selectedTools,
          rawContent,
          planRationale: [],
          constraintWarnings: [],
          failureReason: tier === 'standard' ? 'planner_standard_no_valid_calls' : 'planner_fast_fail_invalid_json',
        };
      }
    } else {
      try {
        if (upgradePlannerIfNeeded('strict json retry')) {
          emit('Strict retry will run on upgraded model.');
        }
        emit('Initial plan invalid. Requesting strict JSON retry...');
        const retryStartedAt = Date.now();
        const controller = new AbortController();
        const retry = await withTimeout(
          ask(
              `You returned invalid or empty JSON.\n` +
              `User request: ${selectionMessage}\n` +
              `You MUST choose at least one ui action or tool call.\n` +
              `Allowed tools: ${selectedTools.join(', ')}.\n` +
              `Return ONLY valid JSON object with keys ui_actions and tool_calls.`,
            controller.signal
          ),
          TOOL_PLANNER_TIMEOUT_MS,
          'strict_json_retry',
          () => controller.abort()
        );
        emit(`Strict JSON retry response in ${Date.now() - retryStartedAt}ms.`);
        rawContent = retry.content;
        emit('Retry response received. Parsing JSON...');
        const candidate = extractCandidateJson(retry.content);
        if (candidate) {
          const parsed = normalizeParsedPlan(JSON.parse(candidate));
          calls = parsed.toolCalls;
          uiActions = parsed.uiActions;
        }
      } catch {
        emit(`Planning failed in ${Date.now() - startedAt}ms.`);
        return {
          success: false,
          plannedCalls: [],
          plannedUiActions: [],
          selectedTools,
          rawContent,
          planRationale: [],
          constraintWarnings: [],
          failureReason: 'planner_retry_error',
        };
      }
    }
  }

  let normalizedPlan = normalizePlannedCalls(calls, userMessage, selectedTools);
  if (normalizedPlan.clarificationQuestion) {
    return {
      success: false,
      plannedCalls: [],
      plannedUiActions: [],
      selectedTools,
      rawContent,
      planRationale: [...normalizedPlan.notes],
      constraintWarnings: [],
      failureReason: 'clarification_needed',
      clarificationQuestion: normalizedPlan.clarificationQuestion,
    };
  }
  calls = normalizedPlan.calls;
  const requiresLinkedInRecencyVerification =
    /\b(linkedin)\b/.test(selectionMessage.toLowerCase()) &&
    /\b(last\s+\d+\s+(day|days|week|weeks|month|months|year|years)|recent|posted|publicly expressed|interest in|interested in)\b/.test(
      selectionMessage.toLowerCase()
    );
  if (
    requiresLinkedInRecencyVerification &&
    calls.length > 0 &&
    !calls.some((call) => call.name.startsWith('browser_'))
  ) {
    emit('Plan lacks live browser verification for LinkedIn recency constraints; requesting repair.');
    try {
      const repair = await withTimeout(ask(
        `Repair the plan.\n` +
        `The request requires LinkedIn recency/behavior verification.\n` +
        `Include browser_search_and_extract and/or browser_list_sub_items calls.\n` +
        `Do not return hybrid_search-only plans.\n` +
        `Return ONLY valid JSON with ui_actions and tool_calls.`
      ), TOOL_PLANNER_TIMEOUT_MS, 'linkedin_recency_repair');
      rawContent = repair.content ?? rawContent;
      const candidate = extractCandidateJson(repair.content);
      if (candidate) {
        const repaired = normalizeParsedPlan(JSON.parse(candidate));
        uiActions = repaired.uiActions;
        normalizedPlan = normalizePlannedCalls(repaired.toolCalls, userMessage, selectedTools);
        calls = normalizedPlan.calls;
      }
    } catch {
      // Keep best-effort plan if repair fails.
    }
  }
  if (
    requiresLinkedInRecencyVerification &&
    !calls.some((call) => call.name.startsWith('browser_')) &&
    selectedTools.includes('browser_search_and_extract')
  ) {
    emit('Repair did not produce browser verification calls; injecting deterministic Sales Navigator fallback plan.');
    calls = buildLinkedInVerificationFallbackCalls(selectionMessage);
    normalizedPlan = normalizePlannedCalls(calls, userMessage, selectedTools);
    calls = normalizedPlan.calls;
  }
  if (
    plannerRoute.complexity.compoundWorkflowRequired &&
    !/\b(document|documents|doc|docx|pdf|file|files|attachment|uploaded|upload)\b/i.test(selectionMessage) &&
    selectedTools.includes('compound_workflow_run') &&
    !calls.some((call) => call.name === 'compound_workflow_run')
  ) {
    emit('Plan missing compound workflow orchestration; injecting deterministic compound workflow run.');
    calls = [
      {
        name: 'compound_workflow_run',
        args: { spec: buildCompoundWorkflowSpecFromQuery(selectionMessage) },
      },
    ];
    normalizedPlan = normalizePlannedCalls(calls, userMessage, selectedTools);
    calls = normalizedPlan.calls;
  }
  emit(`Validated ${calls.length} schema-compliant tool call(s) and ${uiActions.length} ui action(s).`);

  if (calls.length === 0 && uiActions.length === 0) {
    if (tier === 'minimal') {
      emit(`Minimal mode: no repair. Planning failed in ${Date.now() - startedAt}ms.`);
      return {
        success: false,
        plannedCalls: [],
        plannedUiActions: [],
        selectedTools,
        rawContent,
        planRationale: [...normalizedPlan.notes],
        constraintWarnings: [],
        failureReason: 'quick_mode_no_valid_calls',
      };
    }

    if (tier === 'standard' || fastFailJsonRecovery) {
      const aux = await runAuxPlannerFallback(userMessage, conversationHistory, schemaBlock, emit);
      if (aux.calls.length > 0) {
        rawContent = aux.rawContent || rawContent;
        normalizedPlan = normalizePlannedCalls(aux.calls, userMessage, selectedTools);
        calls = normalizedPlan.calls;
        emit(`Auxiliary planner produced ${calls.length} schema-compliant call(s).`);
      } else {
        emit(`Planning failed in ${Date.now() - startedAt}ms.`);
        return {
          success: false,
          plannedCalls: [],
          plannedUiActions: [],
          selectedTools,
          rawContent,
          planRationale: [...normalizedPlan.notes],
          constraintWarnings: [],
          failureReason: tier === 'standard' ? 'planner_standard_no_valid_calls' : 'planner_fast_fail_invalid_calls',
        };
      }
    } else {
      try {
        emit('No valid calls yet. Asking model to repair plan...');
        const repairStartedAt = Date.now();
        const repair = await withTimeout(ask(
          `Repair this tool plan.\n` +
          `User request: ${userMessage}\n` +
          `Issue: no valid schema-compliant tool calls were produced.\n` +
          `Return ONLY valid JSON object with keys ui_actions and tool_calls using allowed args.`
        ), TOOL_PLANNER_TIMEOUT_MS, 'repair');
        emit(`Repair response in ${Date.now() - repairStartedAt}ms.`);
        rawContent = repair.content ?? rawContent;
        const repairCandidate = extractCandidateJson(repair.content);
        if (repairCandidate) {
          const repaired = normalizeParsedPlan(JSON.parse(repairCandidate));
          uiActions = repaired.uiActions;
          normalizedPlan = normalizePlannedCalls(repaired.toolCalls, userMessage, selectedTools);
          calls = normalizedPlan.calls;
          emit(`Repair produced ${calls.length} schema-compliant call(s).`);
        }
      } catch {
        // leave calls empty and try auxiliary planner below
      }
      if (calls.length === 0) {
        const aux = await runAuxPlannerFallback(userMessage, conversationHistory, schemaBlock, emit);
        if (aux.calls.length > 0) {
          rawContent = aux.rawContent || rawContent;
          normalizedPlan = normalizePlannedCalls(aux.calls, userMessage, selectedTools);
          calls = normalizedPlan.calls;
          emit(`Auxiliary planner produced ${calls.length} schema-compliant call(s).`);
        }
      }
    }
  }

  if (calls.length === 0 && uiActions.length === 0) {
    emit('Planning failed: model did not produce a valid call set.');
    emit(`Planning failed in ${Date.now() - startedAt}ms.`);
    return {
      success: false,
      plannedCalls: [],
      plannedUiActions: [],
      selectedTools,
      rawContent,
      planRationale: [...normalizedPlan.notes],
      constraintWarnings: [],
      failureReason: 'invalid_or_empty_plan',
    };
  }

  let coverageWarnings: string[] = [];
  let coverageRisk: 'low' | 'medium' | 'high' = 'low';
  if (ENABLE_PLAN_COVERAGE_AUDIT && tier === 'full') {
    try {
      emit('Auditing plan coverage against user constraints...');
      const auditCoverage = async (
        requestText: string,
        callsToAudit: ParsedToolCall[]
      ): Promise<CoverageAudit | null> => {
        const auditSystem =
          `You are a strict plan coverage auditor.\n` +
          `Given a user request and planned tool calls, identify constraints from the request that are not satisfied by the plan arguments.\n` +
          `Return ONLY JSON object with shape:\n` +
          `{"missing_constraints":["..."],"risk":"low|medium|high","explanation":"..."}`;
        const auditUser =
          `Request:\n${requestText}\n\n` +
          `Planned calls JSON:\n${JSON.stringify(callsToAudit)}\n\n` +
          `Rules:\n` +
          `- Missing constraints include count limits, location filters, industry filters, entity names, and action intents not represented in args/tool choice.\n` +
          `- If all constraints are represented, return missing_constraints as [].\n` +
          `- Keep explanation short.`;

        const auditResp = await askPlanner(
          [
            { role: 'system', content: auditSystem },
            { role: 'user', content: auditUser },
          ],
          { temperature: 0, topP: 1, topK: 1, numPredict: 512 }
        );
        const content = auditResp.content || null;
        const candidate = extractCandidateJson(content);
        if (!candidate) return null;
        const parsed = JSON.parse(candidate) as Partial<CoverageAudit>;
        const missing = Array.isArray(parsed.missing_constraints)
          ? parsed.missing_constraints.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          : [];
        const risk = parsed.risk === 'high' || parsed.risk === 'medium' || parsed.risk === 'low'
          ? parsed.risk
          : (missing.length > 0 ? 'medium' : 'low');
        return {
          missing_constraints: missing,
          risk,
          explanation: typeof parsed.explanation === 'string' ? parsed.explanation : undefined,
        };
      };

      const coverage = await auditCoverage(userMessage, calls);
      if (coverage) {
        coverageWarnings = coverage.missing_constraints;
        coverageRisk = coverage.risk;
        if (coverageWarnings.length > 0) {
          emit(`Coverage audit found ${coverageWarnings.length} missing constraint(s).`);
        } else {
          emit('Coverage audit passed.');
        }
      }
    } catch {
      // Do not fail planning on audit errors.
    }
  }

  const planRationale = buildPlanRationale(
    userMessage,
    calls,
    [...normalizedPlan.notes]
  );
  emit(`Planning succeeded with ${calls.length} tool call(s) and ${uiActions.length} ui action(s).`);
  emit(`Planning total ${Date.now() - startedAt}ms.`);
  return {
    success: true,
    plannedCalls: calls,
    plannedUiActions: uiActions,
    selectedTools,
    rawContent,
    planRationale,
    constraintWarnings: coverageWarnings,
    constraintRisk: coverageRisk,
  };
}
