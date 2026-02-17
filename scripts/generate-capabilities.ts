/**
 * Reference TypeScript implementation for capability generation.
 * Runtime command uses `scripts/generate_capabilities.py` to avoid extra Node transpiler deps.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type ActionParam = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]';
  required: boolean;
};

type Action = {
  id: string;
  description: string;
  params: ActionParam[];
  conditions?: Array<{ description: string }>;
  destructive?: boolean;
};

type Filter = { id: string; type: string; description: string };
type Page = { title: string; route: string; description: string; actions: Action[]; filters: Filter[] };

const root = resolve(__dirname, '..');
const sourcePath = resolve(root, 'ui', 'src', 'capabilities', 'source.json');
const schemaPath = resolve(root, 'ui', 'src', 'capabilities', 'generated', 'schema.ts');
const registryPath = resolve(root, 'ui', 'src', 'capabilities', 'generated', 'registry.json');
const canonicalDocsPath = resolve(root, 'ui', 'src', 'capabilities', 'generated', 'AGENT_CAPABILITIES.md');
const docsIndexPath = resolve(root, 'docs', 'AGENT_CAPABILITIES.md');

const pages = JSON.parse(readFileSync(sourcePath, 'utf-8')) as Page[];

const toTs = (t: ActionParam['type']) => t;
const typeName = (id: string) => `Action_${id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;

const interfaces = pages.flatMap((page) =>
  page.actions.map((action) => {
    const params = action.params
      .map((param) => `  ${param.name}${param.required ? '' : '?'}: ${toTs(param.type)};`)
      .join('\n');
    return `export interface ${typeName(action.id)} {\n  action: '${action.id}';\n${params ? `${params}\n` : ''}}\n`;
  })
);
const union = pages.flatMap((page) => page.actions.map((action) => typeName(action.id))).join(' | ') || 'never';
const schema = `// Auto-generated. Do not edit manually.\n\n${interfaces.join('\n')}\nexport type UIAction = ${union};\n`;

const lines: string[] = ['# UI Capabilities Reference', '', '> Auto-generated. Do not edit manually.', '', '## Pages', ''];
for (const page of pages) {
  lines.push(`### ${page.title} (\`${page.route}\`)`, '', page.description, '');
  if (page.actions.length > 0) {
    lines.push('#### Actions', '', '| Action ID | Description | Parameters | Conditions |', '|-----------|-------------|------------|------------|');
    for (const action of page.actions) {
      const params = action.params.length > 0
        ? action.params.map((param) => `\`${param.name}\` (${param.type}${param.required ? '' : '?'})`).join(', ')
        : '-';
      const conditions = action.conditions?.map((condition) => condition.description).join('; ') || '-';
      lines.push(`| \`${action.id}\`${action.destructive ? ' [destructive]' : ''} | ${action.description} | ${params} | ${conditions} |`);
    }
    lines.push('');
  }
  if (page.filters.length > 0) {
    lines.push('#### Filters', '', '| Filter ID | Type | Description |', '|-----------|------|-------------|');
    for (const filter of page.filters) {
      lines.push(`| \`${filter.id}\` | ${filter.type} | ${filter.description} |`);
    }
    lines.push('');
  }
}

const docsIndex =
  `---\n` +
  `title: "Agent Capabilities"\n` +
  `summary: "Capability-based UI action catalog and generation workflow."\n` +
  `---\n\n` +
  `# Agent Capabilities\n\n` +
  `The canonical generated capability reference is:\n\n` +
  `- \`ui/src/capabilities/generated/AGENT_CAPABILITIES.md\`\n\n` +
  `Related generated artifacts:\n\n` +
  `- \`ui/src/capabilities/generated/registry.json\`\n` +
  `- \`ui/src/capabilities/generated/schema.ts\`\n\n` +
  `Regenerate with:\n\n` +
  `- \`npm --prefix ui run generate:capabilities\`\n`;

writeFileSync(schemaPath, schema, 'utf-8');
writeFileSync(registryPath, JSON.stringify(pages, null, 2), 'utf-8');
writeFileSync(canonicalDocsPath, lines.join('\n'), 'utf-8');
writeFileSync(docsIndexPath, docsIndex, 'utf-8');
console.log('Generated capability schema/docs.');
