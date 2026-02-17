import type { ChatMessage } from '../types/chat';
import { asObject } from './resultExtractors';

export function summarizeResearchResult(result: unknown): string {
  const obj = asObject(result);
  if (!obj) return '';
  const entity =
    typeof obj.company === 'string'
      ? obj.company
      : typeof obj.person === 'string'
        ? obj.person
        : 'the target';
  const research = Array.isArray(obj.research) ? obj.research : [];
  const snippets: string[] = [];

  for (const item of research) {
    const row = asObject(item);
    if (!row) continue;
    const answer = typeof row.answer === 'string' ? row.answer.trim() : '';
    if (answer) {
      snippets.push(answer);
      continue;
    }
    const results = Array.isArray(row.results) ? row.results : [];
    for (const r of results.slice(0, 2)) {
      const rec = asObject(r);
      const title = rec && typeof rec.title === 'string' ? rec.title.trim() : '';
      if (title) snippets.push(title);
    }
  }

  if (snippets.length === 0) {
    return `I researched ${entity}, but there were no concise highlights to summarize.`;
  }
  return `I researched ${entity}. Highlights: ${snippets.slice(0, 3).join(' | ')}`;
}

export function buildResearchCardMessage(result: unknown): ChatMessage | null {
  const obj = asObject(result);
  if (!obj) return null;

  const subjectCompany = typeof obj.company === 'string' ? obj.company.trim() : '';
  const subjectPerson = typeof obj.person === 'string' ? obj.person.trim() : '';
  const subjectName = subjectCompany || subjectPerson;
  if (!subjectName) return null;

  const subjectKind: 'company' | 'person' = subjectCompany ? 'company' : 'person';
  const research = Array.isArray(obj.research) ? obj.research : [];

  let summary = '';
  const highlights: string[] = [];
  const sources: Array<{ title: string; url: string; snippet?: string }> = [];
  const sourceKeySet = new Set<string>();

  const pushHighlight = (value: string) => {
    const text = value.trim();
    if (!text) return;
    if (highlights.some((item) => item.toLowerCase() === text.toLowerCase())) return;
    highlights.push(text);
  };

  for (const item of research) {
    const row = asObject(item);
    if (!row) continue;
    const answer = typeof row.answer === 'string' ? row.answer.trim() : '';
    if (answer) {
      if (!summary) summary = answer;
      pushHighlight(answer);
    }

    const results = Array.isArray(row.results) ? row.results : [];
    for (const entry of results) {
      const rec = asObject(entry);
      if (!rec) continue;
      const title = typeof rec.title === 'string' ? rec.title.trim() : '';
      const url = typeof rec.url === 'string' ? rec.url.trim() : '';
      const snippet = typeof rec.content === 'string' ? rec.content.trim() : '';
      if (title) pushHighlight(title);
      if (!url) continue;
      const sourceKey = `${title}|${url}`.toLowerCase();
      if (sourceKeySet.has(sourceKey)) continue;
      sourceKeySet.add(sourceKey);
      sources.push({
        title: title || url,
        url,
        snippet: snippet || undefined,
      });
    }
  }

  if (!summary) {
    summary = summarizeResearchResult(result);
  }
  if (highlights.length === 0 && summary) {
    pushHighlight(summary);
  }

  return {
    id: `research-card-${Date.now()}`,
    type: 'research_card',
    sender: 'bot',
    timestamp: new Date(),
    subject: {
      kind: subjectKind,
      name: subjectName,
    },
    summary: summary || undefined,
    highlights: highlights.slice(0, 5),
    sources: sources.slice(0, 5),
  };
}
