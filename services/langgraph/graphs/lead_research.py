from __future__ import annotations

import asyncio
import json
import re
from typing import Any, TypedDict
from urllib.parse import urlparse

from langgraph.graph import END, StateGraph
from openai import AsyncOpenAI

import config
from services.search.web_search import tavily_search
from services.leadforge.store import persist_run_summary, replace_run_leads
from api.observability import compute_openai_cost_usd, record_cost

DIRECTORY_HOST_BLOCKLIST = {
    'clutch.co',
    'designrush.com',
    'sortlist.com',
    'goodfirms.co',
    'topdevelopers.co',
    'manifest.com',
    'upcity.com',
    'expertise.com',
    'yelp.com',
    'angi.com',
    'homeadvisor.com',
    'g2.com',
    'trustpilot.com',
    'reddit.com',
    'facebook.com',
    'x.com',
    'twitter.com',
    'linkedin.com',
}


class LeadResearchInput(TypedDict, total=False):
    prompt: str
    options: dict[str, Any]
    run_id: str
    user_id: str


class LeadResearchProgress(TypedDict, total=False):
    step: str
    status: str
    summary: str
    sources: list[dict[str, str]]


class LeadResearchState(TypedDict, total=False):
    input: LeadResearchInput
    criteria: dict[str, Any]
    extraction_strategy: dict[str, Any]
    source_plan: list[str]
    query_plan: dict[str, str]
    raw_results: dict[str, list[dict[str, Any]]]
    leads: list[dict[str, Any]]
    progress: LeadResearchProgress
    results: dict[str, Any]


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _normalize_location_tokens(location: str) -> list[str]:
    raw = (location or '').strip().lower()
    if not raw:
        return []
    parts = re.split(r'[,/]+|\s{2,}', raw)
    tokens: list[str] = []
    for part in parts:
        text = part.strip()
        if not text:
            continue
        tokens.append(text)
        for sub in text.split():
            if len(sub) >= 3:
                tokens.append(sub)
    deduped: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        t = token.strip()
        if not t or t in seen:
            continue
        seen.add(t)
        deduped.append(t)
    return deduped[:12]


def _location_confidence_from_text(location: str, *texts: str) -> float:
    terms = _normalize_location_tokens(location)
    if not terms:
        return 0.5
    haystack = ' '.join((t or '').lower() for t in texts if t).strip()
    if not haystack:
        return 0.0
    hits = sum(1 for token in terms if token in haystack)
    if hits <= 0:
        return 0.0
    return min(1.0, hits / max(2.0, float(len(terms))))


def _safe_domain(url: str) -> str | None:
    try:
        host = urlparse(url).netloc.lower().strip()
        if host.startswith('www.'):
            host = host[4:]
        return host or None
    except Exception:
        return None


def _is_blocked_directory_domain(domain: str | None) -> bool:
    d = (domain or '').strip().lower()
    if not d:
        return True
    return any(d == blocked or d.endswith(f'.{blocked}') for blocked in DIRECTORY_HOST_BLOCKLIST)


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or '').strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.IGNORECASE)
        raw = re.sub(r'\s*```$', '', raw, flags=re.IGNORECASE)
    obj = json.loads(raw)
    return obj if isinstance(obj, dict) else {}


async def _llm_json(prompt: str, *, max_tokens: int = 800, temperature: float = 0.0) -> dict[str, Any]:
    if not config.OPENAI_API_KEY:
        return {}
    client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)
    requested_model = (config.LLM_MODEL_SMART or '').strip() or 'gpt-4o-mini'
    model_candidates = [requested_model]
    if requested_model != 'gpt-4o-mini':
        model_candidates.append('gpt-4o-mini')

    last_exc: Exception | None = None
    for model_name in model_candidates:
        try:
            response = await client.chat.completions.create(
                model=model_name,
                messages=[{'role': 'user', 'content': prompt}],
                temperature=temperature,
                max_tokens=max_tokens,
            )
            usage = response.usage
            if usage:
                record_cost(
                    provider='openai',
                    model=model_name,
                    feature='lead_research',
                    endpoint='services.langgraph.graphs.lead_research._llm_json',
                    usd=compute_openai_cost_usd(model_name, usage.prompt_tokens, usage.completion_tokens),
                    input_tokens=usage.prompt_tokens,
                    output_tokens=usage.completion_tokens,
                )
            content = response.choices[0].message.content or '{}'
            try:
                return _extract_json_object(content)
            except Exception:
                return {}
        except Exception as exc:
            last_exc = exc
            err = str(exc).lower()
            if 'model_not_found' in err or 'does not exist' in err or 'not have access' in err:
                continue
            break

    # Fail soft; upstream graph should continue with fallback behavior.
    return {}


async def _parse_criteria(state: LeadResearchState) -> LeadResearchState:
    input_payload = state.get('input') or {}
    prompt = str(input_payload.get('prompt') or '').strip()
    options = dict(input_payload.get('options') or {})
    llm_prompt = (
        'Parse this lead research request into JSON.\n'
        'Request:\n'
        f'{prompt}\n\n'
        'Return JSON only:\n'
        '{\n'
        '  "query": "string",\n'
        '  "location": "string or empty",\n'
        '  "min_rating": number or null,\n'
        '  "max_results": number,\n'
        '  "intent": "company_lookup|jobs_lookup|mixed",\n'
        '  "people_required": true|false,\n'
        '  "source_hints": ["maps","reviews","licenses","web","firecrawl","jobs"]\n'
        '}'
    )
    parsed = await _llm_json(llm_prompt, max_tokens=400)

    criteria = {
        'raw_prompt': prompt,
        'query': str(parsed.get('query') or prompt).strip(),
        'location': str(parsed.get('location') or options.get('geo_bias') or '').strip(),
        'min_rating': parsed.get('min_rating'),
        'max_results': int(parsed.get('max_results') or options.get('max_results') or 30),
        'intent': str(parsed.get('intent') or 'company_lookup').strip(),
        'people_required': bool(parsed.get('people_required', False)),
        'source_hints': parsed.get('source_hints') if isinstance(parsed.get('source_hints'), list) else [],
    }
    criteria['max_results'] = max(1, min(100, int(criteria['max_results'])))
    if criteria['min_rating'] is not None:
        try:
            criteria['min_rating'] = float(criteria['min_rating'])
        except Exception:
            criteria['min_rating'] = None

    return {
        **state,
        'criteria': criteria,
        'progress': {
            'step': 'parse_criteria',
            'status': 'completed',
            'summary': 'LLM parsed request criteria',
            'sources': [],
        },
    }


async def _build_extraction_strategy(state: LeadResearchState) -> LeadResearchState:
    """
    Prompt-strategy subagent:
    Builds nuanced, criteria-specific extraction instructions for the company selector.
    """
    criteria = state.get('criteria') or {}
    strategy_prompt = (
        'You are a prompt strategist for lead extraction.\n'
        'Given user criteria, produce task-specific extraction instructions.\n'
        'Do not hardcode any specific industry unless present in criteria.\n'
        'Return JSON only:\n'
        '{\n'
        '  "goal": "string",\n'
        '  "must_include": ["..."],\n'
        '  "must_exclude": ["..."],\n'
        '  "quality_checks": ["..."],\n'
        '  "output_constraints": ["..."]\n'
        '}\n\n'
        f'Criteria JSON:\n{json.dumps(criteria, ensure_ascii=True)}'
    )
    strategy = await _llm_json(strategy_prompt, max_tokens=600)
    if not strategy:
        # Lightweight fallback if LLM strategy generation is unavailable.
        strategy = {
            'goal': f"Find real companies matching: {criteria.get('query') or criteria.get('raw_prompt') or ''}",
            'must_include': [
                'official company website/domain when available',
                'clear evidence from source snippet that entity matches requested service/industry',
            ],
            'must_exclude': [
                'job posts',
                'directory or ranking pages when they are not the company website',
            ],
            'quality_checks': [
                'company appears to provide requested service',
                'location relevance to criteria when provided',
            ],
            'output_constraints': [
                'return only plausible, contactable companies',
                'prefer high-confidence matches',
            ],
        }
    return {
        **state,
        'extraction_strategy': strategy,
        'progress': {
            'step': 'build_extraction_strategy',
            'status': 'completed',
            'summary': 'Prompt strategist generated extraction strategy',
            'sources': [],
        },
    }


def _plan_sources(state: LeadResearchState) -> LeadResearchState:
    criteria = state.get('criteria') or {}
    hints = [str(x).strip().lower() for x in (criteria.get('source_hints') or []) if str(x).strip()]
    intent = str(criteria.get('intent') or '').lower()

    default_order = ['maps', 'reviews', 'licenses', 'web', 'firecrawl', 'jobs']
    source_plan = hints if hints else default_order
    source_plan = [src for src in source_plan if src in {'maps', 'reviews', 'licenses', 'web', 'firecrawl', 'jobs'}]

    enabled: list[str] = []
    for src in source_plan:
        if src == 'web' and not config.LEADFORGE_SOURCES_TAVILY:
            continue
        if src == 'maps' and not config.LEADFORGE_SOURCES_MAPS:
            continue
        if src == 'licenses' and not config.LEADFORGE_SOURCES_LICENSES:
            continue
        if src == 'reviews' and not config.LEADFORGE_SOURCES_REVIEWS:
            continue
        if src == 'jobs' and not config.LEADFORGE_SOURCES_JOBS:
            continue
        if src == 'firecrawl' and not config.LEADFORGE_SOURCES_FIRECRAWL:
            continue
        if src == 'jobs' and intent == 'company_lookup':
            continue
        enabled.append(src)
    source_plan = enabled or ['web']

    return {
        **state,
        'source_plan': source_plan,
        'progress': {
            'step': 'plan_sources',
            'status': 'completed',
            'summary': f'Planned source execution: {", ".join(source_plan)}',
            'sources': [],
        },
    }


async def _build_query_plan(state: LeadResearchState) -> LeadResearchState:
    criteria = state.get('criteria') or {}
    source_plan = state.get('source_plan') or []
    llm_prompt = (
        'You are building source-specific web search queries for lead research.\n'
        'Generate concise high-signal queries for each source.\n'
        'Keep queries grounded in requested location and service/industry.\n'
        'Avoid overfitting to listicle spam.\n'
        'Also generate one fallback query per source to use when initial results are sparse.\n'
        'Return JSON only:\n'
        '{"queries": {"maps":"...", "reviews":"...", "licenses":"...", "web":"...", "firecrawl":"...", "jobs":"..."}, "fallback_queries": {"maps":"...", "reviews":"...", "licenses":"...", "web":"...", "firecrawl":"...", "jobs":"..."}}\n\n'
        f'Criteria JSON:\n{json.dumps(criteria, ensure_ascii=True)}\n\n'
        f'Sources JSON:\n{json.dumps(source_plan, ensure_ascii=True)}'
    )
    parsed = await _llm_json(llm_prompt, max_tokens=500)
    queries = parsed.get('queries') if isinstance(parsed.get('queries'), dict) else {}
    fallback_queries = parsed.get('fallback_queries') if isinstance(parsed.get('fallback_queries'), dict) else {}
    query_plan: dict[str, str] = {}
    for src in source_plan:
        value = queries.get(src)
        if isinstance(value, str) and value.strip():
            query_plan[src] = value.strip()
    for src in source_plan:
        fallback_value = fallback_queries.get(src)
        if not (isinstance(fallback_value, str) and fallback_value.strip()):
            continue
        query_plan[f'{src}__fallback'] = fallback_value.strip()

    intent = str(criteria.get('intent') or '').strip().lower()
    location_text = str(criteria.get('location') or '').strip()
    query_text = str(criteria.get('query') or criteria.get('raw_prompt') or '').strip()
    if intent == 'company_lookup' and location_text:
        # Dynamic locality-focused fallback, derived from request criteria only.
        anchor_query = (
            f'"{query_text}" "{location_text}" official company website '
            'best rated local providers '
            '-"top company" -clutch -designrush -sortlist -goodfirms -topdevelopers -upcity -manifest'
        ).strip()
        query_plan['web__fallback'] = anchor_query
    return {
        **state,
        'query_plan': query_plan,
        'progress': {
            'step': 'build_query_plan',
            'status': 'completed',
            'summary': 'Built source-specific search queries',
            'sources': [],
        },
    }


async def _query_source(source: str, criteria: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    query = str(criteria.get('query') or criteria.get('raw_prompt') or '').strip()
    location = str(criteria.get('location') or '').strip()
    min_rating = criteria.get('min_rating')

    if source == 'maps':
        q = f'google maps {query} {location}'.strip()
    elif source == 'reviews':
        q = f'yelp and reviews for {query} {location}'.strip()
    elif source == 'licenses':
        q = f'contractor licensing and company profiles for {query} {location}'.strip()
    elif source == 'firecrawl':
        q = f'official company websites for {query} {location}'.strip()
    elif source == 'jobs':
        q = f'jobs for {query} {location}'.strip()
    else:
        q = f'{query} {location}'.strip()
    if str(criteria.get('intent') or '').lower() == 'company_lookup':
        q = f'{q} -clutch -designrush -sortlist -goodfirms -topdevelopers -upcity -manifest'.strip()
    if min_rating is not None:
        q = f'{q} {min_rating}+ stars'.strip()

    result = await tavily_search(
        q,
        max_results=8,
        include_answer=False,
        search_depth='basic',
        feature='lead_research',
        endpoint=f'lead_research_{source}',
    )
    return source, (result.get('results') or [])


async def _search_sources(state: LeadResearchState) -> LeadResearchState:
    criteria = state.get('criteria') or {}
    source_plan = state.get('source_plan') or []
    query_plan = state.get('query_plan') or {}

    async def _query_source_with_plan(source: str) -> tuple[str, list[dict[str, Any]]]:
        if source in query_plan and str(query_plan.get(source) or '').strip():
            q = str(query_plan[source]).strip()
            result = await tavily_search(
                q,
                max_results=8,
                include_answer=False,
                search_depth='basic',
                feature='lead_research',
                endpoint=f'lead_research_{source}',
            )
            return source, (result.get('results') or [])
        return await _query_source(source, criteria)

    async def _query_fallback(source: str) -> tuple[str, list[dict[str, Any]]]:
        fallback_key = f'{source}__fallback'
        q = str(query_plan.get(fallback_key) or '').strip()
        if not q:
            return source, []
        result = await tavily_search(
            q,
            max_results=5,
            include_answer=False,
            search_depth='advanced',
            feature='lead_research',
            endpoint=f'lead_research_{source}_fallback',
        )
        return source, (result.get('results') or [])

    tasks = [_query_source_with_plan(source) for source in source_plan]
    raw_results: dict[str, list[dict[str, Any]]] = {}
    if tasks:
        all_results = await asyncio.gather(*tasks, return_exceptions=True)
        for item in all_results:
            if isinstance(item, Exception):
                continue
            source, rows = item
            raw_results[source] = rows

    initial_hits = sum(len(v) for v in raw_results.values())
    if initial_hits < 16:
        fallback_tasks = [_query_fallback(source) for source in source_plan]
        fallback_results = await asyncio.gather(*fallback_tasks, return_exceptions=True)
        for item in fallback_results:
            if isinstance(item, Exception):
                continue
            source, rows = item
            if not rows:
                continue
            existing = raw_results.get(source) or []
            seen_urls = {str(r.get('url') or '').strip() for r in existing}
            merged = list(existing)
            for row in rows:
                url = str(row.get('url') or '').strip()
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                merged.append(row)
            raw_results[source] = merged

    source_refs: list[dict[str, str]] = []
    for source, rows in raw_results.items():
        for row in rows[:3]:
            source_refs.append({'source': source, 'url': row.get('url') or '', 'title': row.get('title') or ''})

    return {
        **state,
        'raw_results': raw_results,
        'progress': {
            'step': 'search_sources',
            'status': 'completed',
            'summary': 'Completed multi-source web research',
            'sources': source_refs,
        },
    }


async def _enrich_company(state: LeadResearchState) -> LeadResearchState:
    criteria = state.get('criteria') or {}
    extraction_strategy = state.get('extraction_strategy') or {}
    raw_results = state.get('raw_results') or {}

    candidates: list[dict[str, Any]] = []
    idx = 1
    for source, rows in raw_results.items():
        for row in rows[:10]:
            candidates.append(
                {
                    'candidate_id': idx,
                    'source': source,
                    'title': (row.get('title') or '').strip(),
                    'url': (row.get('url') or '').strip(),
                    'snippet': (row.get('content') or '').strip(),
                }
            )
            idx += 1

    candidate_by_id = {int(c['candidate_id']): c for c in candidates if isinstance(c.get('candidate_id'), int)}

    llm_prompt = (
        'You are selecting real company leads from web results.\n'
        'Follow the extraction strategy exactly.\n'
        'If a candidate is a directory/ranking page, only keep it when there is clear evidence of an underlying official company website/domain in the candidate context.\n'
        'Strictly avoid self-promotional "top X" spam pages without trustworthy corroboration.\n'
        'Website/domain must be the official company site (for example company.com), not aggregator or mirror domains.\n'
        'Extract rating/review values from snippet/title when present (for example "4.8 on Clutch").\n'
        'Do not invent companies or contacts.\n\n'
        f'Criteria JSON:\n{json.dumps(criteria, ensure_ascii=True)}\n\n'
        f'Extraction strategy JSON:\n{json.dumps(extraction_strategy, ensure_ascii=True)}\n\n'
        f'Blocked directory domains JSON:\n{json.dumps(sorted(DIRECTORY_HOST_BLOCKLIST), ensure_ascii=True)}\n\n'
        f'Candidates JSON:\n{json.dumps(candidates, ensure_ascii=True)}\n\n'
        'Return JSON only:\n'
        '{\n'
        '  "leads": [\n'
        '    {\n'
        '      "candidate_id": number,\n'
        '      "company_name": "string",\n'
        '      "domain": "string or null",\n'
        '      "rating": number or null,\n'
        '      "review_count": number or null,\n'
        '      "location": "string or null",\n'
        '      "source_type": "maps|reviews|licenses|web|firecrawl|jobs",\n'
        '      "official_site_confidence": number,\n'
        '      "location_match_confidence": number,\n'
        '      "is_self_promotional_page": true|false,\n'
        '      "relevance": number,\n'
        '      "confidence": number,\n'
        '      "reason": "short reason"\n'
        '    }\n'
        '  ]\n'
        '}'
    )
    parsed = await _llm_json(llm_prompt, max_tokens=1800)
    selected = parsed.get('leads') if isinstance(parsed.get('leads'), list) else []

    leads: list[dict[str, Any]] = []
    for item in selected:
        if not isinstance(item, dict):
            continue
        try:
            candidate_id = int(item.get('candidate_id'))
        except Exception:
            continue
        source_row = candidate_by_id.get(candidate_id)
        if not source_row:
            continue
        url = source_row.get('url') or ''
        domain = (item.get('domain') or '').strip() or _safe_domain(url)
        if _is_blocked_directory_domain(domain):
            continue
        try:
            relevance = float(item.get('relevance') or 0.0)
        except Exception:
            relevance = 0.0
        relevance = max(0.0, min(1.0, relevance))
        try:
            confidence = float(item.get('confidence') or relevance)
        except Exception:
            confidence = relevance
        confidence = max(0.0, min(1.0, confidence))
        official_site_conf = max(0.0, min(1.0, _to_float(item.get('official_site_confidence'), 0.6)))
        location_match_conf = max(0.0, min(1.0, _to_float(item.get('location_match_confidence'), 0.0)))
        if location_match_conf == 0.0:
            location_match_conf = _location_confidence_from_text(
                str(criteria.get('location') or ''),
                str(item.get('location') or ''),
                str(source_row.get('title') or ''),
                str(source_row.get('snippet') or ''),
                str(source_row.get('url') or ''),
            )
        self_promotional = bool(item.get('is_self_promotional_page'))
        if self_promotional and official_site_conf < 0.8:
            continue

        blended_score = round(
            (relevance * 0.45)
            + (confidence * 0.25)
            + (official_site_conf * 0.2)
            + (location_match_conf * 0.1),
            4,
        )
        if blended_score < 0.42:
            continue

        leads.append(
            {
                'name': None,
                'company_name': str(item.get('company_name') or '').strip() or (domain or source_row.get('title') or 'Unknown Company'),
                'domain': domain,
                'email': None,
                'phone': None,
                'title': None,
                'location': str(item.get('location') or criteria.get('location') or '').strip() or None,
                'source_type': str(item.get('source_type') or source_row.get('source') or 'web').strip(),
                'rating': item.get('rating'),
                'review_count': item.get('review_count'),
                'score_total': blended_score,
                'score_breakdown': {
                    'llm_relevance': relevance,
                    'llm_confidence': confidence,
                    'official_site_confidence': official_site_conf,
                    'location_match_confidence': location_match_conf,
                    'is_self_promotional_page': self_promotional,
                    'llm_reason': str(item.get('reason') or '').strip(),
                },
                'dedupe_key': (domain or str(item.get('company_name') or '').strip().lower()),
                'evidence': [
                    {
                        'kind': str(source_row.get('source') or '').strip(),
                        'url': url,
                        'title': str(source_row.get('title') or '').strip(),
                        'snippet': str(source_row.get('snippet') or '').strip(),
                        'tool_name': 'tavily_search',
                        'confidence': blended_score,
                    }
                ],
            }
        )

    if not leads and candidates:
        rescue_prompt = (
            'You are a rescue validator for lead candidates.\n'
            'Return only candidates that clearly match user query + location.\n'
            'If none match, return empty array.\n'
            'Never return random unrelated entities.\n'
            'Return JSON only: {"leads":[{"candidate_id":number,"company_name":"string","domain":"string or null","source_type":"string","relevance":number,"reason":"string"}]}\n\n'
            f'Criteria JSON:\n{json.dumps(criteria, ensure_ascii=True)}\n\n'
            f'Candidates JSON:\n{json.dumps(candidates, ensure_ascii=True)}'
        )
        rescue = await _llm_json(rescue_prompt, max_tokens=1400)
        rescue_items = rescue.get('leads') if isinstance(rescue.get('leads'), list) else []
        for item in rescue_items:
            if not isinstance(item, dict):
                continue
            try:
                candidate_id = int(item.get('candidate_id'))
            except Exception:
                continue
            source_row = candidate_by_id.get(candidate_id)
            if not source_row:
                continue
            url = source_row.get('url') or ''
            domain = (item.get('domain') or '').strip() or _safe_domain(url)
            if _is_blocked_directory_domain(domain):
                continue
            try:
                relevance = float(item.get('relevance') or 0.0)
            except Exception:
                relevance = 0.0
            relevance = max(0.0, min(1.0, relevance))
            if relevance < 0.62:
                continue
            leads.append(
                {
                    'name': None,
                    'company_name': str(item.get('company_name') or '').strip() or (domain or source_row.get('title') or 'Unknown Company'),
                    'domain': domain,
                    'email': None,
                    'phone': None,
                    'title': None,
                    'location': str(criteria.get('location') or '').strip() or None,
                    'source_type': str(item.get('source_type') or source_row.get('source') or 'web').strip(),
                    'rating': None,
                    'review_count': None,
                    'score_total': relevance,
                    'score_breakdown': {'rescue_relevance': relevance, 'rescue_reason': str(item.get('reason') or '').strip()},
                    'dedupe_key': (domain or str(item.get('company_name') or '').strip().lower()),
                    'evidence': [
                        {
                            'kind': str(source_row.get('source') or '').strip(),
                            'url': url,
                            'title': str(source_row.get('title') or '').strip(),
                            'snippet': str(source_row.get('snippet') or '').strip(),
                            'tool_name': 'tavily_search',
                            'confidence': relevance,
                        }
                    ],
                }
            )

    # Sparse-result expansion:
    # If we have too few company leads, mine company names from directory/list snippets,
    # then resolve official company domains via fresh search queries.
    intent = str(criteria.get('intent') or '').strip().lower()
    min_target = 5 if intent == 'company_lookup' else 0
    if len(leads) < min_target and candidates:
        directory_candidates = []
        for c in candidates:
            domain = _safe_domain(str(c.get('url') or ''))
            if not _is_blocked_directory_domain(domain):
                continue
            directory_candidates.append(
                {
                    'candidate_id': c.get('candidate_id'),
                    'source': c.get('source'),
                    'title': c.get('title'),
                    'url': c.get('url'),
                    'snippet': c.get('snippet'),
                }
            )
        if directory_candidates:
            expansion_prompt = (
                'You are extracting COMPANY NAMES (not directory sites) from ranking/list snippets.\n'
                'Goal: identify real companies that match user intent.\n'
                'Do not return directory hosts or generic category phrases.\n'
                'Return JSON only:\n'
                '{\n'
                '  "companies": [\n'
                '    {"name":"string","location_hint":"string or null","reason":"short reason"}\n'
                '  ]\n'
                '}\n\n'
                f'Criteria JSON:\n{json.dumps(criteria, ensure_ascii=True)}\n\n'
                f'Directory candidates JSON:\n{json.dumps(directory_candidates[:30], ensure_ascii=True)}'
            )
            expansion = await _llm_json(expansion_prompt, max_tokens=1200)
            expansion_companies = expansion.get('companies') if isinstance(expansion.get('companies'), list) else []
            mined_names: list[tuple[str, str]] = []
            seen_names: set[str] = set()
            for row in expansion_companies:
                if not isinstance(row, dict):
                    continue
                name = str(row.get('name') or '').strip()
                if len(name) < 3:
                    continue
                lowered = name.lower()
                if lowered in seen_names:
                    continue
                seen_names.add(lowered)
                mined_names.append((name, str(row.get('location_hint') or '').strip()))
                if len(mined_names) >= 12:
                    break

            if mined_names:
                async def _resolve_company(name: str, location_hint: str) -> dict[str, Any] | None:
                    location = location_hint or str(criteria.get('location') or '').strip()
                    q = (
                        f'"{name}" {location} official website '
                        f'{str(criteria.get("query") or criteria.get("raw_prompt") or "").strip()} '
                        '-clutch -designrush -sortlist -goodfirms -topdevelopers -upcity -manifest'
                    ).strip()
                    result = await tavily_search(
                        q,
                        max_results=4,
                        include_answer=False,
                        search_depth='advanced',
                        feature='lead_research',
                        endpoint='lead_research_company_expand',
                    )
                    rows = [r for r in (result.get('results') or []) if isinstance(r, dict)]
                    for row in rows:
                        url = str(row.get('url') or '').strip()
                        domain = _safe_domain(url)
                        if _is_blocked_directory_domain(domain):
                            continue
                        title = str(row.get('title') or '').strip()
                        snippet = str(row.get('content') or '').strip()
                        loc_conf = _location_confidence_from_text(location, title, snippet, url, name)
                        if loc_conf <= 0 and location:
                            continue
                        return {
                            'name': name,
                            'domain': domain,
                            'url': url,
                            'title': title,
                            'snippet': snippet,
                            'location': location or None,
                            'location_confidence': loc_conf,
                        }
                    return None

                resolve_tasks = [_resolve_company(name, loc) for name, loc in mined_names[:8]]
                resolved = await asyncio.gather(*resolve_tasks, return_exceptions=True)
                existing_keys = {str(l.get('dedupe_key') or '').strip().lower() for l in leads}
                for item in resolved:
                    if isinstance(item, Exception) or not item:
                        continue
                    key = str(item.get('domain') or item.get('name') or '').strip().lower()
                    if not key or key in existing_keys:
                        continue
                    existing_keys.add(key)
                    loc_conf = max(0.0, min(1.0, _to_float(item.get('location_confidence'), 0.4)))
                    seed_score = round((0.52 * 0.5) + (0.75 * 0.35) + (loc_conf * 0.15), 4)
                    leads.append(
                        {
                            'name': None,
                            'company_name': str(item.get('name') or '').strip() or 'Unknown Company',
                            'domain': str(item.get('domain') or '').strip() or None,
                            'email': None,
                            'phone': None,
                            'title': None,
                            'location': item.get('location'),
                            'source_type': 'web',
                            'rating': None,
                            'review_count': None,
                            'score_total': seed_score,
                            'score_breakdown': {
                                'llm_relevance': 0.52,
                                'llm_confidence': 0.75,
                                'official_site_confidence': 0.75,
                                'location_match_confidence': loc_conf,
                                'is_self_promotional_page': False,
                                'llm_reason': 'Expanded from directory/list discovery and resolved official site',
                            },
                            'dedupe_key': key,
                            'evidence': [
                                {
                                    'kind': 'web',
                                    'url': str(item.get('url') or ''),
                                    'title': str(item.get('title') or ''),
                                    'snippet': str(item.get('snippet') or ''),
                                    'tool_name': 'tavily_search',
                                    'confidence': seed_score,
                                }
                            ],
                        }
                    )

    return {
        **state,
        'leads': leads,
        'progress': {
            'step': 'enrich_company',
            'status': 'completed',
            'summary': f'LLM normalized {len(leads)} lead candidates',
            'sources': [],
        },
    }


async def _llm_validate_companies(state: LeadResearchState) -> LeadResearchState:
    criteria = state.get('criteria') or {}
    leads = list(state.get('leads') or [])
    if not leads:
        return {
            **state,
            'progress': {
                'step': 'llm_validate_companies',
                'status': 'completed',
                'summary': 'No leads to validate',
                'sources': [],
            },
        }

    validator_cap = 15
    payload = []
    for idx, lead in enumerate(leads[:validator_cap], start=1):
        evidence = []
        for ev in (lead.get('evidence') or [])[:2]:
            if not isinstance(ev, dict):
                continue
            evidence.append(
                {
                    'kind': str(ev.get('kind') or ''),
                    'url': str(ev.get('url') or ''),
                    'title': str(ev.get('title') or ''),
                    'snippet': str(ev.get('snippet') or ''),
                }
            )
        payload.append(
            {
                'id': idx,
                'dedupe_key': str(lead.get('dedupe_key') or ''),
                'company_name': str(lead.get('company_name') or ''),
                'domain': str(lead.get('domain') or ''),
                'location': str(lead.get('location') or ''),
                'source_type': str(lead.get('source_type') or ''),
                'score_total': _to_float(lead.get('score_total'), 0.0),
                'evidence': evidence,
            }
        )

    prompt = (
        'You are a strict lead-quality validator.\n'
        'Task: evaluate whether each company genuinely matches the user request.\n'
        'Use evidence only. Do not invent facts.\n'
        'Be especially strict with self-promotional SEO pages claiming relevance without proof.\n'
        'When prompt includes a specific location, require strong locality evidence and assign high promotional_risk (>0.8) to generic self-promotional pages without verifiable local presence.\n'
        'Examples:\n'
        '- Good: established provider with explicit local HQ/address evidence and service match -> high match/local_presence, low promotional_risk\n'
        '- Bad: generic SEO landing page claiming local expertise without concrete local proof -> low match/local_presence, high promotional_risk\n'
        'Return JSON only:\n'
        '{\n'
        '  "assessments": [\n'
        '    {\n'
        '      "id": number,\n'
        '      "match_strength": number,\n'
        '      "local_presence_confidence": number,\n'
        '      "service_fit_confidence": number,\n'
        '      "promotional_risk": number,\n'
        '      "confidence": number,\n'
        '      "reason": "short reason"\n'
        '    }\n'
        '  ]\n'
        '}\n\n'
        f'Criteria JSON:\n{json.dumps(criteria, ensure_ascii=True)}\n\n'
        f'Candidates JSON:\n{json.dumps(payload, ensure_ascii=True)}'
    )
    parsed = await _llm_json(prompt, max_tokens=2200)
    assessments = parsed.get('assessments') if isinstance(parsed.get('assessments'), list) else []
    by_id: dict[int, dict[str, Any]] = {}
    for row in assessments:
        if not isinstance(row, dict):
            continue
        try:
            row_id = int(row.get('id'))
        except Exception:
            continue
        by_id[row_id] = row

    location_required = bool(str(criteria.get('location') or '').strip())
    validated: list[dict[str, Any]] = []
    for idx, lead in enumerate(leads[:validator_cap], start=1):
        assessment = by_id.get(idx) or {}
        match_strength = max(0.0, min(1.0, _to_float(assessment.get('match_strength'), 0.5)))
        local_presence = max(0.0, min(1.0, _to_float(assessment.get('local_presence_confidence'), 0.5)))
        service_fit = max(0.0, min(1.0, _to_float(assessment.get('service_fit_confidence'), 0.5)))
        promotional_risk = max(0.0, min(1.0, _to_float(assessment.get('promotional_risk'), 0.5)))
        validator_conf = max(0.0, min(1.0, _to_float(assessment.get('confidence'), 0.5)))
        base = max(0.0, min(1.0, _to_float(lead.get('score_total'), 0.0)))

        adjusted = (
            (base * 0.45)
            + (match_strength * 0.25)
            + (service_fit * 0.15)
            + (local_presence * 0.15)
            - (promotional_risk * 0.25)
        )
        adjusted = round(max(0.0, min(0.99, adjusted)), 4)

        # Keep strict but generic: drop obvious low-fit promotional matches.
        if match_strength < 0.35 and service_fit < 0.35:
            continue
        if promotional_risk > 0.8 and adjusted < 0.55:
            continue
        if location_required and local_presence < 0.2 and adjusted < 0.62:
            continue
        if location_required and local_presence < 0.4 and adjusted < 0.74:
            continue

        lead['score_total'] = adjusted
        lead['score_breakdown'] = {
            **(lead.get('score_breakdown') or {}),
            'validator_match_strength': match_strength,
            'validator_local_presence_confidence': local_presence,
            'validator_service_fit_confidence': service_fit,
            'validator_promotional_risk': promotional_risk,
            'validator_confidence': validator_conf,
            'validator_reason': str(assessment.get('reason') or '').strip(),
        }
        validated.append(lead)

    # Preserve any remaining leads beyond validator cap.
    validated.extend(leads[validator_cap:])
    validated = sorted(validated, key=lambda x: _to_float(x.get('score_total'), 0.0), reverse=True)
    return {
        **state,
        'leads': validated,
        'progress': {
            'step': 'llm_validate_companies',
            'status': 'completed',
            'summary': f'Validated {len(validated)} leads with LLM quality gate',
            'sources': [],
        },
    }


async def _query_people_for_company(company_name: str, location: str, domain: str | None) -> list[dict[str, Any]]:
    parts = [company_name.strip()]
    if location.strip():
        parts.append(location.strip())
    if domain:
        parts.append(domain)
    subject = ' '.join([p for p in parts if p]).strip()
    q = f'{subject} leadership team executives decision makers official site linkedin -clutch -designrush -sortlist'
    result = await tavily_search(
        q,
        max_results=5,
        include_answer=False,
        search_depth='basic',
        feature='lead_research',
        endpoint='lead_research_people',
    )
    return result.get('results') or []


async def _enrich_people(state: LeadResearchState) -> LeadResearchState:
    criteria = state.get('criteria') or {}
    if not bool(criteria.get('people_required')):
        return {
            **state,
            'progress': {
                'step': 'enrich_people',
                'status': 'completed',
                'summary': 'People enrichment skipped (people_required=false)',
                'sources': [],
            },
        }
    company_leads = state.get('leads') or []
    if not company_leads:
        return {
            **state,
            'progress': {
                'step': 'enrich_people',
                'status': 'completed',
                'summary': 'No company leads to enrich with people',
                'sources': [],
            },
        }

    # Only expand top companies to keep latency/cost bounded.
    max_companies = min(10, max(3, int(criteria.get('max_results') or 30)))
    top_companies = sorted(company_leads, key=lambda x: float(x.get('score_total') or 0.0), reverse=True)[:max_companies]

    tasks = [
        _query_people_for_company(
            str(lead.get('company_name') or ''),
            str(criteria.get('location') or lead.get('location') or ''),
            str(lead.get('domain') or '').strip() or None,
        )
        for lead in top_companies
    ]
    people_hits_by_company: dict[str, list[dict[str, Any]]] = {}
    hit_sources: list[dict[str, str]] = []
    if tasks:
        all_hits = await asyncio.gather(*tasks, return_exceptions=True)
        for idx, item in enumerate(all_hits):
            lead = top_companies[idx]
            key = str(lead.get('dedupe_key') or lead.get('company_name') or idx).strip().lower()
            rows: list[dict[str, Any]] = []
            if not isinstance(item, Exception):
                rows = [r for r in item if isinstance(r, dict)]
            people_hits_by_company[key] = rows
            for row in rows[:2]:
                hit_sources.append(
                    {
                        'source': 'people',
                        'url': str(row.get('url') or ''),
                        'title': str(row.get('title') or ''),
                    }
                )

    llm_companies_payload = []
    for lead in top_companies:
        key = str(lead.get('dedupe_key') or lead.get('company_name') or '').strip().lower()
        llm_companies_payload.append(
            {
                'company_key': key,
                'company_name': lead.get('company_name'),
                'domain': lead.get('domain'),
                'location': lead.get('location') or criteria.get('location'),
                'people_candidates': [
                    {
                        'title': str(row.get('title') or ''),
                        'url': str(row.get('url') or ''),
                        'snippet': str(row.get('content') or ''),
                    }
                    for row in (people_hits_by_company.get(key) or [])[:5]
                ],
            }
        )

    llm_prompt = (
        'Extract decision-maker PEOPLE candidates from these company search results.\n'
        'Focus on realistic outreach contacts (founder, owner, ceo, vp, director, head, operations, marketing).\n'
        'Do NOT output directory-profile people from Clutch/DesignRush/Sortlist.\n'
        'Only return people clearly tied to the company official website, company LinkedIn page, or reputable coverage.\n'
        'Return strict JSON only.\n\n'
        f'User criteria JSON:\n{json.dumps(criteria, ensure_ascii=True)}\n\n'
        f'Company payload JSON:\n{json.dumps(llm_companies_payload, ensure_ascii=True)}\n\n'
        'Return JSON schema:\n'
        '{\n'
        '  "people": [\n'
        '    {\n'
        '      "company_key": "string",\n'
        '      "name": "string",\n'
        '      "title": "string or null",\n'
        '      "linkedin_url": "string or null",\n'
        '      "email": "string or null",\n'
        '      "phone": "string or null",\n'
        '      "confidence": number,\n'
        '      "reason": "short reason",\n'
        '      "source_url": "string or null"\n'
        '    }\n'
        '  ]\n'
        '}'
    )
    parsed = await _llm_json(llm_prompt, max_tokens=2200)
    people = parsed.get('people') if isinstance(parsed.get('people'), list) else []

    base_by_key: dict[str, dict[str, Any]] = {
        str(lead.get('dedupe_key') or lead.get('company_name') or '').strip().lower(): lead
        for lead in top_companies
    }
    person_leads: list[dict[str, Any]] = []
    for row in people:
        if not isinstance(row, dict):
            continue
        company_key = str(row.get('company_key') or '').strip().lower()
        base = base_by_key.get(company_key)
        if not base:
            continue
        name = str(row.get('name') or '').strip()
        if not name:
            continue
        try:
            confidence = float(row.get('confidence') or 0.0)
        except Exception:
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))
        source_url = str(row.get('source_url') or '').strip()
        evidence = list(base.get('evidence') or [])
        if source_url:
            evidence.append(
                {
                    'kind': 'people',
                    'url': source_url,
                    'title': str(row.get('title') or name),
                    'snippet': str(row.get('reason') or ''),
                    'tool_name': 'llm_people_extraction',
                    'confidence': confidence,
                }
            )
        person_leads.append(
            {
                **base,
                'name': name,
                'title': (str(row.get('title') or '').strip() or None),
                'email': (str(row.get('email') or '').strip() or None),
                'phone': (str(row.get('phone') or '').strip() or None),
                'score_total': max(float(base.get('score_total') or 0.0), confidence),
                'score_breakdown': {
                    **(base.get('score_breakdown') or {}),
                    'person_confidence': confidence,
                    'person_reason': str(row.get('reason') or '').strip(),
                    'person_linkedin_url': (str(row.get('linkedin_url') or '').strip() or None),
                },
                'dedupe_key': f"{str(base.get('company_name') or '').strip().lower()}::{name.lower()}",
                'evidence': evidence,
            }
        )

    final_leads = person_leads if person_leads else company_leads
    summary = (
        f'Promoted {len(person_leads)} person-level contacts from {len(top_companies)} companies'
        if person_leads
        else 'No confident people extracted; keeping company-level leads'
    )
    return {
        **state,
        'leads': final_leads,
        'progress': {
            'step': 'enrich_people',
            'status': 'completed',
            'summary': summary,
            'sources': hit_sources[:12],
        },
    }


def _score_and_dedup(state: LeadResearchState) -> LeadResearchState:
    deduped: dict[str, dict[str, Any]] = {}
    for lead in state.get('leads') or []:
        key = str(lead.get('dedupe_key') or '').strip().lower()
        if not key:
            if lead.get('name'):
                key = f"{str(lead.get('company_name') or '').strip().lower()}::{str(lead.get('name') or '').strip().lower()}"
            else:
                key = str(lead.get('domain') or lead.get('company_name') or '').strip().lower()
        if not key:
            continue
        existing = deduped.get(key)
        if not existing:
            deduped[key] = dict(lead)
            continue
        existing['score_total'] = max(float(existing.get('score_total') or 0.0), float(lead.get('score_total') or 0.0))
        existing['evidence'] = (existing.get('evidence') or []) + (lead.get('evidence') or [])
        if existing.get('rating') is None and lead.get('rating') is not None:
            existing['rating'] = lead.get('rating')
        if existing.get('review_count') is None and lead.get('review_count') is not None:
            existing['review_count'] = lead.get('review_count')

    sorted_leads = sorted(deduped.values(), key=lambda x: float(x.get('score_total') or 0.0), reverse=True)
    calibrated: list[dict[str, Any]] = []
    for lead in sorted_leads:
        base = max(0.0, min(1.0, _to_float(lead.get('score_total'), 0.0)))
        breakdown = dict(lead.get('score_breakdown') or {})
        official_site_conf = max(0.0, min(1.0, _to_float(breakdown.get('official_site_confidence'), 0.6)))
        location_match_conf = max(0.0, min(1.0, _to_float(breakdown.get('location_match_confidence'), 0.0)))
        if location_match_conf == 0.0:
            location_match_conf = _location_confidence_from_text(
                str((state.get('criteria') or {}).get('location') or lead.get('location') or ''),
                str(lead.get('company_name') or ''),
                str(lead.get('location') or ''),
                str(lead.get('domain') or ''),
                ' '.join(str(e.get('snippet') or '') for e in (lead.get('evidence') or [])[:2]),
            )

        rating = lead.get('rating')
        review_count = lead.get('review_count')
        try:
            rating_value = float(rating) if rating is not None else 0.0
        except Exception:
            rating_value = 0.0
        try:
            reviews_value = float(review_count) if review_count is not None else 0.0
        except Exception:
            reviews_value = 0.0
        rating_bonus = 0.0 if rating_value <= 0 else min(1.0, max(0.0, (rating_value - 3.5) / 1.5))
        review_bonus = 0.0 if reviews_value <= 0 else min(1.0, reviews_value / 150.0)

        source_type = str(lead.get('source_type') or '').strip().lower()
        source_bonus = 0.1 if source_type in {'maps', 'licenses', 'reviews'} else 0.0
        evidence_kinds = {
            str(ev.get('kind') or '').strip().lower()
            for ev in (lead.get('evidence') or [])
            if isinstance(ev, dict) and str(ev.get('kind') or '').strip()
        }
        corroboration = 1.0 if len(evidence_kinds) >= 2 else 0.0
        self_promotional_penalty = 0.2 if bool(breakdown.get('is_self_promotional_page')) else 0.0

        calibrated_score = (
            (base * 0.45)
            + (official_site_conf * 0.2)
            + (location_match_conf * 0.15)
            + (rating_bonus * 0.08)
            + (review_bonus * 0.06)
            + (corroboration * 0.04)
            + source_bonus
            - self_promotional_penalty
        )
        calibrated_score = round(max(0.0, min(0.99, calibrated_score)), 4)
        lead['score_total'] = calibrated_score
        lead['score_breakdown'] = {
            **breakdown,
            'calibrated': True,
            'calibrated_score': calibrated_score,
            'rating_bonus': rating_bonus,
            'review_bonus': review_bonus,
            'corroboration_bonus': corroboration,
            'source_bonus': source_bonus,
            'self_promotional_penalty': self_promotional_penalty,
        }
        calibrated.append(lead)

    sorted_leads = sorted(calibrated, key=lambda x: float(x.get('score_total') or 0.0), reverse=True)
    return {
        **state,
        'leads': sorted_leads,
        'progress': {
            'step': 'score_and_dedup',
            'status': 'completed',
            'summary': f'Deduped candidates down to {len(sorted_leads)} leads',
            'sources': [],
        },
    }


def _persist_results(state: LeadResearchState) -> LeadResearchState:
    input_payload = state.get('input') or {}
    run_id = str(input_payload.get('run_id') or '').strip()
    prompt = str(input_payload.get('prompt') or '').strip()
    criteria = state.get('criteria') or {}
    user_id = str(input_payload.get('user_id') or config.LEADFORGE_DEFAULT_USER_ID).strip() or config.LEADFORGE_DEFAULT_USER_ID
    leads = state.get('leads') or []

    if run_id:
        persist_run_summary(run_id=run_id, prompt=prompt, criteria=criteria, status='running', user_id=user_id)
        replace_run_leads(run_id, leads)

    return {
        **state,
        'progress': {
            'step': 'persist_results',
            'status': 'completed',
            'summary': f'Persisted {len(leads)} leads and evidence',
            'sources': [],
        },
    }


def _format_table(state: LeadResearchState) -> LeadResearchState:
    leads = state.get('leads') or []
    criteria = state.get('criteria') or {}
    intent = str(criteria.get('intent') or '').lower()
    max_results = int(criteria.get('max_results') or 30)
    if intent == 'company_lookup':
        max_results = min(max_results, 12)
    top = leads[: max_results]
    results = {
        'count': len(top),
        'items': top,
        'summary': {
            'sources_used': list((state.get('raw_results') or {}).keys()),
            'query': criteria.get('raw_prompt') or '',
            'target_range': '5-12' if intent == 'company_lookup' else None,
        },
    }
    safe_results = json.loads(json.dumps(results, ensure_ascii=True))
    return {
        **state,
        'results': safe_results,
        'progress': {
            'step': 'format_table',
            'status': 'completed',
            'summary': f'Prepared {safe_results.get("count", 0)} leads for API response',
            'sources': [],
        },
    }


def build_lead_research_graph():
    graph = StateGraph(LeadResearchState)
    graph.add_node('parse_criteria', _parse_criteria)
    graph.add_node('build_extraction_strategy', _build_extraction_strategy)
    graph.add_node('plan_sources', _plan_sources)
    graph.add_node('build_query_plan', _build_query_plan)
    graph.add_node('search_sources', _search_sources)
    graph.add_node('enrich_company', _enrich_company)
    graph.add_node('llm_validate_companies', _llm_validate_companies)
    graph.add_node('enrich_people', _enrich_people)
    graph.add_node('score_and_dedup', _score_and_dedup)
    graph.add_node('persist_results', _persist_results)
    graph.add_node('format_table', _format_table)

    graph.set_entry_point('parse_criteria')
    graph.add_edge('parse_criteria', 'build_extraction_strategy')
    graph.add_edge('build_extraction_strategy', 'plan_sources')
    graph.add_edge('plan_sources', 'build_query_plan')
    graph.add_edge('build_query_plan', 'search_sources')
    graph.add_edge('search_sources', 'enrich_company')
    graph.add_edge('enrich_company', 'llm_validate_companies')
    graph.add_edge('llm_validate_companies', 'enrich_people')
    graph.add_edge('enrich_people', 'score_and_dedup')
    graph.add_edge('score_and_dedup', 'persist_results')
    graph.add_edge('persist_results', 'format_table')
    graph.add_edge('format_table', END)
    return graph.compile()
