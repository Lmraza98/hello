export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  intentMessage: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/status',
    label: 'Status Overview',
    description: 'Show dashboard status, metrics, and current summary.',
    intentMessage: 'status',
  },
  {
    command: '/find',
    label: 'Find Contact',
    description: 'Lookup a person. Example: /find John Doe at Acme',
    intentMessage: 'find contact',
  },
  {
    command: '/outreach',
    label: 'Contact Outreach',
    description: 'Start outreach flow. Example: /outreach John Doe at Acme',
    intentMessage: 'email contact',
  },
  {
    command: '/campaigns',
    label: 'List Campaigns',
    description: 'Show all campaigns and statuses.',
    intentMessage: 'list campaigns',
  },
  {
    command: '/conversations',
    label: 'Active Conversations',
    description: 'Show active/open reply conversations.',
    intentMessage: 'conversations',
  },
  {
    command: '/leads',
    label: 'Lead Generation',
    description: 'Run LeadForge lead research. Example: /leads HVAC companies in Austin TX',
    intentMessage: 'lead research',
  },
  {
    command: '/research',
    label: 'Company Research',
    description: 'Research a company. Example: /research Acme Corp',
    intentMessage: 'research company',
  },
  {
    command: '/check-jobs',
    label: 'Check Jobs',
    description: 'Check running background tasks and scraping status.',
    intentMessage: 'check job status',
  },
  {
    command: '/help',
    label: 'Help',
    description: 'Show supported commands and assistant capabilities.',
    intentMessage: 'help',
  },
];

export function parseSlashCommand(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const [command, ...rest] = trimmed.split(/\s+/);
  const args = rest.join(' ').trim();
  const entry = SLASH_COMMANDS.find((item) => item.command === command.toLowerCase());

  if (!entry) return null;

  if (!args) {
    return entry.intentMessage;
  }

  switch (entry.command) {
    case '/find':
      return `find ${args}`;
    case '/outreach':
      return `email ${args}`;
    case '/leads':
      return args ? `lead research ${args}` : null;
    case '/research':
      return `research ${args}`;
    default:
      return `${entry.intentMessage} ${args}`.trim();
  }
}
