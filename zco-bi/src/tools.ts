export const ZCO_BI_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_top_prospects',
      description: 'Get companies ranked by prospect score.',
      parameters: {
        type: 'object',
        properties: {
          vertical: { type: 'string' },
          company_size: { type: 'string', enum: ['startup', 'smb', 'mid_market', 'enterprise'] },
          min_score: { type: 'number' },
          tier: { type: 'string', enum: ['A', 'B', 'C'] },
          status: { type: 'string' },
          has_signal_type: { type: 'string' },
          has_mobile_app: { type: 'boolean' },
          state: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_companies',
      description: 'Search companies with text + structured filters.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          vertical: { type: 'string' },
          tier: { type: 'string', enum: ['A', 'B', 'C'] },
          status: { type: 'string' },
          company_size: { type: 'string', enum: ['startup', 'smb', 'mid_market', 'enterprise'] },
          min_score: { type: 'number' },
          has_mobile_app: { type: 'boolean' },
          state: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_company_detail',
      description: 'Get full detail on a specific company.',
      parameters: {
        type: 'object',
        properties: {
          company_id: { type: 'number' },
          domain: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_company_signals',
      description: 'Get buying-intent signals for a company or globally.',
      parameters: {
        type: 'object',
        properties: {
          company_id: { type: 'number' },
          signal_type: { type: 'string' },
          signal_strength: { type: 'string', enum: ['weak', 'medium', 'strong', 'critical'] },
          days: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_engagement_summary',
      description: 'Get engagement history with a company.',
      parameters: {
        type: 'object',
        properties: {
          company_id: { type: 'number' },
          days: { type: 'number' },
          channel: { type: 'string', enum: ['email', 'linkedin', 'phone', 'meeting'] },
          limit: { type: 'number' },
        },
        required: ['company_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_contact_recommendations',
      description: 'Get ranked contacts by seniority and decision-maker status.',
      parameters: {
        type: 'object',
        properties: {
          company_id: { type: 'number' },
          seniority: { type: 'string', enum: ['c_suite', 'vp', 'director', 'manager', 'individual'] },
          department: { type: 'string' },
          has_email: { type: 'boolean' },
          status: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_pipeline_by_vertical',
      description: 'Get pipeline breakdown by vertical and company size.',
      parameters: {
        type: 'object',
        properties: {
          vertical: { type: 'string' },
          company_size: { type: 'string', enum: ['startup', 'smb', 'mid_market', 'enterprise'] },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_conversion_analytics',
      description: 'See what verticals and company sizes convert best.',
      parameters: {
        type: 'object',
        properties: {
          vertical: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_campaign_performance',
      description: 'Get campaign performance metrics.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number' },
          status: { type: 'string', enum: ['draft', 'active', 'paused', 'completed'] },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_next_best_actions',
      description: 'Get recommended next actions across prospects.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_signal_feed',
      description: 'Get a feed of recent signals across all companies.',
      parameters: {
        type: 'object',
        properties: {
          signal_types: { type: 'array', items: { type: 'string' } },
          min_prospect_score: { type: 'number' },
          tier: { type: 'string', enum: ['A', 'B', 'C'] },
          days: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_daily_digest',
      description: 'Get summary of what changed today.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_score_changes',
      description: 'See which companies had recent score movement.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number' },
          min_delta: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_ingestion',
      description: 'Trigger ingestion from a source.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['salesnav', 'csv', 'crunchbase', 'appstore', 'linkedin_jobs', 'builtwith', 'manual'] },
          config: { type: 'object' },
        },
        required: ['source'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'score_companies',
      description: 'Re-score all companies or one company.',
      parameters: {
        type: 'object',
        properties: {
          company_id: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'browser_salesnav_search',
      description: 'Browser-level Sales Navigator search for accounts/leads.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          search_type: { type: 'string', enum: ['accounts', 'leads'] },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
] as const;

export type ZcoToolName = typeof ZCO_BI_TOOLS[number]['function']['name'];
