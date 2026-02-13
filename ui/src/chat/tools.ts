import type { ToolDefinition } from './chatEngineTypes';

export const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'hybrid_search',
      description:
        'Unified local-first search across CRM entities, email messages/threads, conversations, notes, and semantic chunks. Returns evidence refs for grounding.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language query' },
          entity_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Subset of: contact, company, campaign, note, conversation, email_message, email_thread, file_chunk',
          },
          filters: {
            type: 'object',
            description: 'Optional filters (time_range, campaign_id, company_id, contact_id, domain, folder, scope)',
          },
          k: { type: 'number', description: 'Max results to return (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_contacts',
      description:
        "Search contacts in the database. Filter by contact name, company name, email presence, or today's additions. Returns array of contacts with id, name, company, title, email, phone, linkedin_url, salesforce_url, etc.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Filter by contact name' },
          company: { type: 'string', description: 'Filter by company name' },
          has_email: { type: 'boolean', description: 'Only contacts with email addresses' },
          today_only: { type: 'boolean', description: "Only contacts added today" },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_contact',
      description: 'Get a single contact by their database ID. Re-prompts the user if not enough information is provided. Returns full contact record.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name' },
          company_name: { type: 'string', description: 'Company they work at' }, 
          contact_id: { type: 'number', description: 'Contact database ID' },
        },
        required: ['contact_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_contact',
      description:
        'Add a new contact to the database. Requires name and company_name at minimum. Returns the created contact with its new ID.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name' },
          company_name: { type: 'string', description: 'Company they work at' },
          title: { type: 'string', description: 'Job title' },
          email: { type: 'string', description: 'Email address' },
          phone: { type: 'string', description: 'Phone number' },
          linkedin_url: { type: 'string', description: 'LinkedIn profile URL' },
          domain: { type: 'string', description: 'Company domain (e.g. acme.com)' },
          salesforce_url: { type: 'string', description: 'Salesforce record URL' },
        },
        required: ['name', 'company_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_contact',
      description: 'Delete a single contact by ID. Returns {deleted: true}.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'number', description: 'Contact ID to delete' },
        },
        required: ['contact_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'salesforce_search_contact',
      description:
        'Queue a Salesforce search for a contact to find/link their Salesforce record. The search runs in the background using browser automation.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'number', description: 'Contact ID to search in Salesforce' },
        },
        required: ['contact_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_upload_to_salesforce',
      description:
        'Generate a Salesforce-compatible CSV and launch the Data Importer for selected contacts. Opens a browser window.',
      parameters: {
        type: 'object',
        properties: {
          contact_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Contact IDs to upload',
          },
        },
        required: ['contact_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_send_linkedin_requests',
      description: 'Send LinkedIn connection requests to selected contacts via browser automation.',
      parameters: {
        type: 'object',
        properties: {
          contact_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Contact IDs to send requests to',
          },
        },
        required: ['contact_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_collect_phone',
      description: 'Discover phone numbers for selected contacts using web scraping and enrichment APIs.',
      parameters: {
        type: 'object',
        properties: {
          contact_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Contact IDs to find phones for',
          },
        },
        required: ['contact_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_delete_contacts',
      description: 'Delete multiple contacts by their IDs.',
      parameters: {
        type: 'object',
        properties: {
          contact_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Contact IDs to delete',
          },
        },
        required: ['contact_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_contacts_csv',
      description:
        "Export contacts as a CSV file. Returns a download URL. Can filter to today-only or email-only.",
      parameters: {
        type: 'object',
        properties: {
          today_only: { type: 'boolean', description: "Only export today's contacts" },
          with_email_only: { type: 'boolean', description: 'Only contacts that have emails' },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'search_companies',
      description:
        "Get companies from the database. Returns array with id, company_name, domain, tier, vertical, status, etc.",
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Text search across company name, domain, vertical, and notes fields' },
          company_name: { type: 'string', description: 'Filter by company name (partial match)' },
          vertical: { type: 'string', description: 'Filter by industry/vertical (partial match)' },
          tier: { type: 'string', description: "Filter by tier (e.g. 'A', 'B', 'C')" },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_filter_values',
      description:
        'List distinct available values for a filter field so plans can use canonical values (supports prefix narrowing). Use this before applying strict filters when value uncertainty exists.',
      parameters: {
        type: 'object',
        properties: {
          tool_name: { type: 'string', description: 'Optional target tool name (for context)' },
          arg_name: { type: 'string', description: 'Filter argument name to inspect (e.g., vertical, tier, status, company_name)' },
          starts_with: { type: 'string', description: 'Optional case-insensitive prefix to narrow values (e.g., con)' },
          limit: { type: 'number', description: 'Max values to return (default 25)' },
        },
        required: ['arg_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_company',
      description: 'Add a company to the database.',
      parameters: {
        type: 'object',
        properties: {
          company_name: { type: 'string', description: 'Company name' },
          domain: { type: 'string', description: 'Company domain' },
          tier: { type: 'string', description: 'Tier classification' },
          vertical: { type: 'string', description: 'Industry vertical' },
          target_reason: { type: 'string', description: 'Why this company is a target' },
          wedge: { type: 'string', description: 'Sales wedge/angle' },
        },
        required: ['company_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_company',
      description: 'Delete a single company by ID.',
      parameters: {
        type: 'object',
        properties: {
          company_id: { type: 'number', description: 'Company ID' },
        },
        required: ['company_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'collect_companies_from_salesnav',
      description:
        'Use LinkedIn Sales Navigator to find companies matching a natural language query. Saves to database by default. Takes 1-5 minutes depending on results.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              "Natural language query like 'SaaS companies in Boston with 50-200 employees'",
          },
          max_companies: { type: 'number', description: 'Max companies to collect (default 100)' },
          save_to_db: { type: 'boolean', description: 'Save results to database (default true)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_company_vetted',
      description: 'Mark a company as vetted after review, optionally with an ICP score.',
      parameters: {
        type: 'object',
        properties: {
          company_id: { type: 'number', description: 'Company ID' },
          icp_score: { type: 'number', description: 'ICP fit score (1-10)' },
        },
        required: ['company_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_companies_count',
      description: 'Get the count of companies in pending status (not yet processed).',
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_campaigns',
      description:
        'Get all email campaigns with stats and templates. Each campaign has id, name, status, num_emails, days_between_emails, templates[], stats{}.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status: draft, active, paused, completed',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_campaign',
      description: 'Get details for a single campaign including templates and stats.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID' },
        },
        required: ['campaign_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_campaign',
      description: 'Create a new email campaign with a name and optional settings.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Campaign name' },
          description: { type: 'string', description: 'Campaign description' },
          num_emails: { type: 'number', description: 'Number of emails in sequence (default 3)' },
          days_between_emails: {
            type: 'number',
            description: 'Days between each email (default 3)',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'activate_campaign',
      description: 'Activate a campaign to start sending emails.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID to activate' },
        },
        required: ['campaign_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause_campaign',
      description: 'Pause a campaign to stop sending emails.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID to pause' },
        },
        required: ['campaign_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enroll_contacts_in_campaign',
      description: 'Enroll contacts in an email campaign. Contacts must have email addresses.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID' },
          contact_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Contact IDs to enroll',
          },
        },
        required: ['campaign_id', 'contact_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_campaign_contacts',
      description: 'Get contacts enrolled in a campaign with their enrollment status.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID' },
          status: { type: 'string', description: 'Filter by enrollment status' },
        },
        required: ['campaign_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_campaign_stats',
      description:
        'Get statistics for a specific campaign: total contacts, sent, opened, replied, open rate, reply rate.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID' },
        },
        required: ['campaign_id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_email_dashboard_metrics',
      description:
        'Get aggregated email metrics: reply rate, meeting booking rate, active conversations count, best performing campaign, daily send/view/reply chart data, and recent replies.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Lookback period in days (default 30)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_review_queue',
      description:
        'Get all emails pending human review before sending. Each item includes rendered subject, body, contact info, and campaign info.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'approve_email',
      description:
        'Approve a single email for sending. Optionally provide edited subject/body to override the generated content.',
      parameters: {
        type: 'object',
        properties: {
          email_id: { type: 'number', description: 'Email ID to approve' },
          subject: { type: 'string', description: 'Edited subject line (optional)' },
          body: { type: 'string', description: 'Edited body text (optional)' },
        },
        required: ['email_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reject_email',
      description: 'Reject an email from the review queue. It will not be sent.',
      parameters: {
        type: 'object',
        properties: {
          email_id: { type: 'number', description: 'Email ID to reject' },
        },
        required: ['email_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'approve_all_emails',
      description: 'Bulk approve multiple emails at once.',
      parameters: {
        type: 'object',
        properties: {
          email_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Email IDs to approve',
          },
        },
        required: ['email_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_campaign_emails',
      description:
        'Trigger sending campaign emails via Salesforce automation. Launches browser automation in a background process.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Specific campaign (or omit for all active)' },
          limit: { type: 'number', description: 'Max emails to send this batch' },
          review_mode: {
            type: 'boolean',
            description: 'If true, drafts go to review queue first (default true)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_email_batch',
      description:
        "Prepare today's batch of emails - generates draft emails for contacts that are due. Run this before reviewing/sending.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_scheduled_emails',
      description: 'Get future scheduled emails with send times, contact info, and status.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Filter by campaign' },
          limit: { type: 'number', description: 'Max results (default 200)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email_now',
      description: 'Send a single scheduled/approved email immediately via Salesforce automation.',
      parameters: {
        type: 'object',
        properties: {
          email_id: { type: 'number', description: 'Email ID to send now' },
        },
        required: ['email_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_conversations',
      description:
        'Get contacts who have replied to our emails. These are active conversations needing attention. Includes reply preview, contact info, campaign info.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Look back period in days (default 30)' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_conversation_thread',
      description:
        'Get the full email conversation thread with a contact - all sent emails and their replies in chronological order.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'number', description: 'Contact ID' },
        },
        required: ['contact_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_email',
      description:
        'Generate a preview of what a campaign email will look like for a specific contact. Shows the rendered subject and body with all variables filled in.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID' },
          contact_id: { type: 'number', description: 'Contact ID' },
          step_number: { type: 'number', description: 'Email step number (default 1)' },
        },
        required: ['campaign_id', 'contact_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_conversation_handled',
      description: 'Mark a reply/conversation as handled so it is removed from the active conversations list.',
      parameters: {
        type: 'object',
        properties: {
          reply_id: { type: 'number', description: 'Reply ID to mark as handled' },
        },
        required: ['reply_id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'start_pipeline',
      description:
        'Start the lead generation pipeline - scrapes contacts from pending companies via Sales Navigator. Runs in background.',
      parameters: {
        type: 'object',
        properties: {
          tier: { type: 'string', description: 'Company tier to process' },
          max_contacts: { type: 'number', description: 'Max contacts to collect (default 25)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_pipeline',
      description: 'Stop the currently running pipeline.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pipeline_status',
      description: 'Check if the pipeline is running and see its log output.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_email_discovery',
      description: "Run email discovery on existing contacts who don't have email addresses yet.",
      parameters: {
        type: 'object',
        properties: {
          workers: { type: 'number', description: 'Parallel workers (default 5)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_phone_discovery',
      description: 'Run phone number discovery on existing contacts.',
      parameters: {
        type: 'object',
        properties: {
          workers: { type: 'number', description: 'Parallel workers (default 10)' },
          today_only: { type: 'boolean', description: "Only process today's contacts" },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'salesnav_person_search',
      description:
        'Search for a person on LinkedIn Sales Navigator by name. Returns profile cards with name, title, company, linkedin_url, location.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string', description: 'First name' },
          last_name: { type: 'string', description: 'Last name' },
          company: { type: 'string', description: 'Company name to narrow search' },
          max_results: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['first_name', 'last_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'salesnav_scrape_leads',
      description:
        'Scrape decision-maker contacts from companies via Sales Navigator. For each company, finds leadership and saves contacts to database.',
      parameters: {
        type: 'object',
        properties: {
          companies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                domain: { type: 'string' },
                linkedin_url: { type: 'string' },
              },
              required: ['name'],
            },
            description: 'Companies to scrape leads from',
          },
          title_filter: { type: 'string', description: 'Filter by title keywords' },
          max_per_company: { type: 'number', description: 'Max leads per company (default 10)' },
        },
        required: ['companies'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_health',
      description:
        'Check whether the browser control gateway is reachable and healthy.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_tabs',
      description:
        'List open browser tabs from the browser control gateway. Use this before navigation when tab context is unclear.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description:
        'Navigate a browser tab to a URL through the browser control gateway. Use this for navigation instead of scraper tools.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute URL to navigate to' },
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description:
        'Get a structured page snapshot with stable refs. Call this before browser_act and again after navigation or major DOM changes.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
          mode: { type: 'string', description: 'Snapshot style: ai or role' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_act',
      description:
        'Execute a browser action by snapshot ref. Use refs from browser_snapshot, not CSS selectors.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot (for numeric refs pass as string)' },
          action: { type: 'string', description: 'Action type: click, type, fill, press, hover, select' },
          value: { type: 'string', description: 'Optional value for type/fill/select/press actions' },
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
        },
        required: ['ref', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_find_ref',
      description:
        'Find the best matching ref from the latest browser_snapshot by visible text (and optional role).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to match in snapshot labels, e.g. Search' },
          role: { type: 'string', description: 'Optional role filter, e.g. input or textbox' },
          timeout_ms: { type: 'number', description: 'Optional retry timeout in ms (default 8000)' },
          poll_ms: { type: 'number', description: 'Optional retry poll interval in ms (default 400)' },
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait',
      description:
        'Wait in the controlled browser session before the next snapshot/action.',
      parameters: {
        type: 'object',
        properties: {
          ms: { type: 'number', description: 'Wait duration in milliseconds (default 1000)' },
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description:
        'Capture a screenshot of the current browser tab for verification.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
          full_page: { type: 'boolean', description: 'Capture the full page instead of viewport only' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_extract_companies',
      description:
        'Extract top company search results from the current Sales Navigator account-search page.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
          limit: { type: 'number', description: 'Max companies to extract (default 5)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_salesnav_search_account',
      description:
        'One-shot Sales Navigator account search: opens account search, submits query, optionally clicks best matching company, and returns top extracted companies.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Account search text to submit' },
          click_company: { type: 'string', description: 'Optional company name to click from results' },
          wait_ms: { type: 'number', description: 'Optional wait after submit before extraction (default 3000)' },
          limit: { type: 'number', description: 'Max extracted companies (default 5)' },
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
        },
        required: ['query'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'research_company',
      description:
        'Research a company using web search. Returns search results useful for ICP assessment and outreach personalization.',
      parameters: {
        type: 'object',
        properties: {
          company_name: { type: 'string', description: 'Company to research' },
          industry: { type: 'string', description: 'Known industry' },
          context: { type: 'string', description: 'Additional context for search' },
        },
        required: ['company_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research_person',
      description: 'Research a person using web search for outreach personalization context.',
      parameters: {
        type: 'object',
        properties: {
          person_name: { type: 'string', description: "Person's full name" },
          company_name: { type: 'string', description: 'Their company' },
          title: { type: 'string', description: 'Their job title' },
        },
        required: ['person_name', 'company_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assess_icp_fit',
      description:
        'Use AI to assess how well a company fits the ideal customer profile. Returns score (1-10), reasoning, services relevance, and talking points.',
      parameters: {
        type: 'object',
        properties: {
          company_name: { type: 'string', description: 'Company name' },
          industry: { type: 'string' },
          headcount: { type: 'string' },
          location: { type: 'string' },
          research_summary: { type: 'string', description: 'Prior research to base assessment on' },
        },
        required: ['company_name'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_salesforce_auth_status',
      description:
        "Check Salesforce authentication status. Returns 'authenticated', 'expired', or 'not_configured'.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trigger_salesforce_reauth',
      description: 'Trigger Salesforce re-authentication. Opens browser in background for login.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_stats',
      description:
        "Get high-level stats: total companies, total contacts, contacts with email, contacts added today.",
      parameters: { type: 'object', properties: {} },
    },
  },
];
