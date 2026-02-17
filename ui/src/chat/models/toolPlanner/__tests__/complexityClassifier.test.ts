import { describe, expect, it } from 'vitest';

import { assessComplexity } from '../complexityClassifier';

describe('complexityClassifier', () => {
  it('routes simple navigation to gemma', () => {
    expect(assessComplexity('go to contacts').recommendedModel).toBe('gemma');
    expect(assessComplexity('show me campaigns').recommendedModel).toBe('gemma');
  });

  it('routes entity lookup to gemma', () => {
    expect(assessComplexity('who is Lucas Raza').recommendedModel).toBe('gemma');
  });

  it('routes multi-step tasks to gpt-4o-mini', () => {
    const query = 'find 10 companies in healthcare and then generate emails for each';
    expect(assessComplexity(query).recommendedModel).toBe('gpt-4o-mini');
  });

  it('routes sales navigator queries to gpt-4o-mini', () => {
    const query = 'search for companies on Sales Navigator in the manufacturing sector';
    expect(assessComplexity(query).recommendedModel).toBe('gpt-4o-mini');
  });

  it('routes compound criteria to gpt-4o-mini', () => {
    const query = 'find companies that are in healthcare AND have a VP who posted about AI';
    expect(assessComplexity(query).recommendedModel).toBe('gpt-4o-mini');
  });

  it('marks compound workflow required for recency + linkedin + batch constraints', () => {
    const query = 'Identify 10 companies in manufacturing on Sales Navigator with VP of Operations who posted about AI in the last 6 months';
    expect(assessComplexity(query).compoundWorkflowRequired).toBe(true);
  });
});
