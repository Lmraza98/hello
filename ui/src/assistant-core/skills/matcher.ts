/**
 * Skill matcher: determines which skill (if any) should handle a user message.
 *
 * Matching is purely deterministic — no LLM calls.  Trigger patterns from the
 * skill definition are matched against the lowercased user message.  Patterns
 * can contain `{placeholder}` tokens that match any non-empty word sequence.
 *
 * Confidence scoring:
 *   - Each matched pattern contributes to the score.
 *   - Longer patterns and more matches increase confidence.
 *   - Threshold: 0.5 minimum for a match to be considered.
 */

import type { SkillDefinition, SkillMatch } from '../domain/types';

const MATCH_THRESHOLD = 0.4;

/**
 * Convert a trigger pattern like `"targeting {industry}"` into a regex
 * that matches `"targeting banks"` and captures `"banks"` as a named group.
 */
function patternToRegex(pattern: string): RegExp {
  // Escape regex special chars except `{}`
  const escaped = pattern.replace(/[.*+?^$|()[\]\\]/g, '\\$&');
  // Replace {placeholder} with named capture group
  const withCaptures = escaped.replace(
    /\\\{(\w+)\\\}/g,
    (_match, name: string) => `(?<${name}>.+?)`
  );
  return new RegExp(withCaptures, 'i');
}

/**
 * Check if a trigger pattern matches the user message.
 * Returns the match confidence (0 or pattern-length-based score).
 */
function matchPattern(
  message: string,
  pattern: string
): { matched: boolean; confidence: number; captures: Record<string, string> } {
  const lower = message.toLowerCase().trim();
  const patternLower = pattern.toLowerCase().trim();

  // Simple substring match (most trigger patterns are short phrases)
  if (lower.includes(patternLower)) {
    // Confidence proportional to pattern length vs message length
    const lengthRatio = patternLower.length / Math.max(lower.length, 1);
    return {
      matched: true,
      confidence: Math.min(0.3 + lengthRatio * 0.7, 1.0),
      captures: {},
    };
  }

  // Regex match for patterns with {placeholders}
  if (pattern.includes('{')) {
    const regex = patternToRegex(patternLower);
    const match = lower.match(regex);
    if (match) {
      const captures: Record<string, string> = {};
      if (match.groups) {
        for (const [key, value] of Object.entries(match.groups)) {
          if (value) captures[key] = value.trim();
        }
      }
      const lengthRatio = patternLower.replace(/\{[^}]+\}/g, '').trim().length / Math.max(lower.length, 1);
      return {
        matched: true,
        confidence: Math.min(0.25 + lengthRatio * 0.6, 0.9),
        captures,
      };
    }
  }

  return { matched: false, confidence: 0, captures: {} };
}

/**
 * Match a user message against a single skill's trigger patterns.
 */
export function matchSkill(
  message: string,
  skill: SkillDefinition
): SkillMatch | null {
  const matchedPatterns: string[] = [];
  let totalConfidence = 0;
  let maxConfidence = 0;

  for (const pattern of skill.triggerPatterns) {
    const result = matchPattern(message, pattern);
    if (result.matched) {
      matchedPatterns.push(pattern);
      totalConfidence += result.confidence;
      maxConfidence = Math.max(maxConfidence, result.confidence);
    }
  }

  if (matchedPatterns.length === 0) return null;

  // Aggregate confidence: boost for multiple matches
  const multiMatchBonus = Math.min((matchedPatterns.length - 1) * 0.15, 0.3);
  const confidence = Math.min(maxConfidence + multiMatchBonus, 1.0);

  if (confidence < MATCH_THRESHOLD) return null;

  return {
    skill,
    confidence,
    matchedPatterns,
  };
}

/**
 * Match a user message against all registered skills.
 * Returns the best match (highest confidence), or null.
 */
export function matchBestSkill(
  message: string,
  skills: SkillDefinition[]
): SkillMatch | null {
  let best: SkillMatch | null = null;

  for (const skill of skills) {
    const match = matchSkill(message, skill);
    if (match && (!best || match.confidence > best.confidence)) {
      best = match;
    }
  }

  return best;
}
