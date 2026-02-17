export async function runBrowserSkillList(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  qs: (params: Record<string, unknown>) => string,
  args: Record<string, unknown>
): Promise<unknown> {
  return api('GET', `/api/browser/skills${qs(args)}`);
}

export async function runBrowserSkillMatch(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  args: Record<string, unknown>
): Promise<unknown> {
  return api('POST', '/api/browser/skills/match', args);
}

export async function runBrowserSkillGet(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  args: Record<string, unknown>
): Promise<unknown> {
  return api('GET', `/api/browser/skills/${args.skill_id}`);
}

export async function runBrowserSkillUpsert(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  args: Record<string, unknown>
): Promise<unknown> {
  return api('PUT', `/api/browser/skills/${args.skill_id}`, { content: args.content });
}

export async function runBrowserSkillDelete(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  args: Record<string, unknown>
): Promise<unknown> {
  return api('DELETE', `/api/browser/skills/${args.skill_id}`);
}

export async function runBrowserSkillRepair(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  args: Record<string, unknown>
): Promise<unknown> {
  return api('POST', `/api/browser/skills/${args.skill_id}/repair`, {
    issue: args.issue,
    context: args.context,
    action: args.action,
    role: args.role,
    text: args.text,
  });
}
