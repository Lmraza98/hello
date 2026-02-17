export function stripPlannerHeuristicContext(userMessage: string): string {
  const raw = String(userMessage || '');
  const stripped = raw
    .replace(/\n?\[SESSION_ENTITIES\][\s\S]*?\[\/SESSION_ENTITIES\]\n?/gi, '\n')
    .replace(/\n?\[BROWSER_SESSION\][\s\S]*?\[\/BROWSER_SESSION\]\n?/gi, '\n')
    .trim();
  return stripped || raw;
}
