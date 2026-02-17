import { describe, expect, it } from 'vitest';
import { buildCompoundWorkflowSpecFromQuery } from '../toolPlan';

function phaseOneFilters(spec: Record<string, unknown>): Record<string, unknown> {
  const phases = Array.isArray(spec.phases) ? (spec.phases as Array<Record<string, unknown>>) : [];
  const first = phases[0] || {};
  const templates =
    first.param_templates && typeof first.param_templates === 'object'
      ? (first.param_templates as Record<string, unknown>)
      : {};
  const filters =
    templates.filters && typeof templates.filters === 'object'
      ? (templates.filters as Record<string, unknown>)
      : {};
  return filters;
}

describe('compound workflow deterministic fallback spec', () => {
  it('keeps headquarters filter and lets backend resolve industry from full query', () => {
    const spec = buildCompoundWorkflowSpecFromQuery(
      'Identify 10 manufacturing companies producing industrial machinery in the United States'
    ) as Record<string, unknown>;
    const filters = phaseOneFilters(spec);
    expect(filters.headquarters_location).toBe('United States');
    expect(filters.industry).toBeUndefined();
  });

  it('does not hardcode healthcare industry in frontend fallback filters', () => {
    const spec = buildCompoundWorkflowSpecFromQuery(
      'Find healthcare companies in the United States'
    ) as Record<string, unknown>;
    const filters = phaseOneFilters(spec);
    expect(filters.headquarters_location).toBe('United States');
    expect(filters.industry).toBeUndefined();
  });

  it('adds deterministic people filters for VP of Operations phases', () => {
    const spec = buildCompoundWorkflowSpecFromQuery(
      'Identify 10 companies in manufacturing in the United States with VP of Operations'
    ) as Record<string, unknown>;
    const phases = Array.isArray(spec.phases) ? (spec.phases as Array<Record<string, unknown>>) : [];
    const phase2 = phases.find((p) => p.id === 'phase_2_find_vp_ops') || {};
    const phase2Templates =
      phase2.param_templates && typeof phase2.param_templates === 'object'
        ? (phase2.param_templates as Record<string, unknown>)
        : {};
    const phase2Filters =
      phase2Templates.filters && typeof phase2Templates.filters === 'object'
        ? (phase2Templates.filters as Record<string, unknown>)
        : {};

    expect(phase2Filters.function).toBe('Operations');
    expect(phase2Filters.seniority_level).toBe('Vice President');
    expect(phase2Filters.headquarters_location).toBe('United States');
    expect(phase2Filters.current_company).toBe('{{company.name}}');
  });
});
