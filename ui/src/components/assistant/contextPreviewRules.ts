import type { WorkspaceInteractionState } from '../shell/workspaceLayout';

type PreviewCandidate = Pick<WorkspaceInteractionState, 'kind' | 'route'> | null;

// Keep preview opening deterministic and tightly scoped.
export function isContextPreviewAllowed(interaction: PreviewCandidate): boolean {
  if (!interaction) return false;
  
  // We only allow context preview for specific workflows or specific complex interaction kinds.
  if (typeof interaction.route !== 'string') return false;

  // Bulk Data Review / Browser workflows
  if (interaction.route.startsWith('/browser')) return true;

  // Drafting/Content Creation: /email, /templates
  if (interaction.route.startsWith('/email') || interaction.route.startsWith('/templates')) return true;

  // Deep-Dive Entity Analysis: When explicit navigation or selection happens to a specific entity
  if (interaction.kind === 'selection' && interaction.route.startsWith('/contacts')) {
    return true;
  }

  // Otherwise, default to keeping interaction in chat (Entity lookups, List Filtering, Status Checks, Single-step writes)
  return false;
}
