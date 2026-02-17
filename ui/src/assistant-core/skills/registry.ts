/**
 * In-memory skill registry.
 *
 * Skills are registered at app startup.  The registry stores both the
 * skill definition (from SKILL.md frontmatter) and the handler function
 * (from the TS implementation).
 */

import type { SkillDefinition, SkillHandler, SkillMatch } from '../domain/types';
import { matchBestSkill } from './matcher';

type RegisteredSkill = {
  definition: SkillDefinition;
  handler: SkillHandler;
};

const _skills = new Map<string, RegisteredSkill>();

export function registerSkill(definition: SkillDefinition, handler: SkillHandler): void {
  _skills.set(definition.id, { definition, handler });
}

export function getSkill(id: string): RegisteredSkill | undefined {
  return _skills.get(id);
}

export function getAllSkills(): SkillDefinition[] {
  return [..._skills.values()].map((s) => s.definition);
}

export function getHandler(id: string): SkillHandler | undefined {
  return _skills.get(id)?.handler;
}

export function matchMessage(message: string): SkillMatch | null {
  return matchBestSkill(message, getAllSkills());
}

export function clearRegistry(): void {
  _skills.clear();
}
