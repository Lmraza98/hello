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
            description:
              'Optional filters (time_range, campaign_id, company_id, contact_id, domain, folder, scope, document_ids, document_type, document_status, per_doc_cap, max_evidence_tokens, rerank)',
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
      name: 'resolve_entity',
      description:
        'Deterministic exact resolver for local entities (name/email/phone/id/domain). Use this before broad search when user asks for a specific known contact/company/campaign.',
      parameters: {
        type: 'object',
        properties: {
          name_or_identifier: { type: 'string', description: 'Exact name, email, phone, domain, or numeric id' },
          entity_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Subset of: contact, company, campaign',
          },
          k: { type: 'number', description: 'Max results to return (default 10)' },
        },
        required: ['name_or_identifier'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_documents',
      description:
        'Answer questions from uploaded documents using retrieval with source citations. Use this first when user asks about file/document contents.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question to answer from indexed documents' },
          document_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional specific document IDs to scope retrieval',
          },
          company_id: { type: 'number', description: 'Optional company scope for linked documents' },
          contact_id: { type: 'number', description: 'Optional contact scope for linked documents' },
          limit_chunks: { type: 'number', description: 'Max chunks to retrieve (default 5)' },
          per_doc_cap: { type: 'number', description: 'Max chunks per document (default 3)' },
          max_evidence_tokens: { type: 'number', description: 'Evidence token budget (default ~2800)' },
          rerank: { type: 'boolean', description: 'Enable reranking (default true)' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description:
        'Search uploaded documents by filename/content/summary and metadata. Use to locate relevant files before ask_documents when scope is unclear.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query across document metadata/content' },
          document_type: {
            type: 'string',
            description: 'Optional type filter: proposal|contract|transcript|meeting_notes|email_thread|linkedin_export|contact_list|invoice|report|other',
          },
          company_id: { type: 'number', description: 'Optional linked company filter' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document_summary',
      description: 'Get summary and metadata for a specific uploaded document.',
      parameters: {
        type: 'object',
        properties: {
          document_id: { type: 'string', description: 'Document ID' },
        },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_company_documents',
      description: 'List uploaded documents linked to a specific company.',
      parameters: {
        type: 'object',
        properties: {
          company_id: { type: 'number', description: 'Company ID' },
          limit: { type: 'number', description: 'Max results (default 100)' },
        },
        required: ['company_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_contacts',
      description:
        "Search contacts in the database. Use 'query' for broad free-text search across company name, contact name, title, domain, and vertical/industry " +
        "(e.g. query='banks' finds contacts at bank companies, with banking titles, etc.). " +
        "Use specific filters (name, company, vertical) to narrow further. Returns array of contacts with id, name, company, title, email, vertical, etc.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: "Free-text search across company name, contact name, title, domain, and vertical. Use this for industry/category searches like 'banks', 'veterinary', 'construction'." },
          name: { type: 'string', description: 'Filter by exact contact name' },
          company: { type: 'string', description: 'Filter by exact company name' },
          vertical: { type: 'string', description: "Filter by exact vertical/industry field value, e.g. 'Veterinary Services'" },
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
      description: 'Get a single contact by their database ID. Returns full contact record.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'number', description: 'Contact database ID' },
        },
        required: ['contact_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_note',
      description:
        'Create a note attached to an entity (contact/company/campaign/etc). Use this to store user/assistant annotations for later retrieval.',
      parameters: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            description: 'Entity type: contact|company|campaign|conversation|email_thread|email_message',
          },
          entity_id: { type: 'string', description: 'Entity ID (string or numeric id serialized as string)' },
          content: { type: 'string', description: 'Note content' },
        },
        required: ['entity_type', 'entity_id', 'content'],
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
      name: 'enroll_contacts_by_filter',
      description:
        'Enroll all contacts matching filter criteria into a campaign. ' +
        'Use this instead of enroll_contacts_in_campaign when enrolling many contacts by industry, company, or other filter. ' +
        "The 'query' parameter does broad text search across company name, title, domain, and vertical " +
        "(e.g. query='banks' finds all banking-related contacts). " +
        'The server queries and enrolls contacts in one operation — no need to pass individual IDs.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID to enroll contacts into' },
          query: { type: 'string', description: "Free-text search across company name, title, domain, vertical. Use for industry searches like 'banks', 'veterinary', 'construction'." },
          vertical: { type: 'string', description: "Filter by exact vertical/industry field value" },
          company: { type: 'string', description: 'Filter by company name' },
          has_email: { type: 'boolean', description: 'Only contacts with email addresses' },
        },
        required: ['campaign_id'],
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
      name: 'approve_campaign_review_queue',
      description:
        'Approve all review-queue emails for a specific campaign (up to limit).',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID' },
          limit: { type: 'number', description: 'Max review items to approve (default 50)' },
        },
        required: ['campaign_id'],
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
      name: 'reschedule_campaign_emails',
      description:
        'Reschedule approved pending emails in a campaign to N days from now.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID' },
          days_from_now: { type: 'number', description: 'Days from now to schedule sends' },
          limit: { type: 'number', description: 'Max scheduled emails to reschedule (default 200)' },
        },
        required: ['campaign_id', 'days_from_now'],
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
      name: 'browser_tasks_status',
      description:
        'List browser automation tasks and their current status/progress. Use this to check running tasks before retrying or when user asks what is still running.',
      parameters: {
        type: 'object',
        properties: {
          include_finished: { type: 'boolean', description: 'Include finished/failed tasks (default false).' },
          limit: { type: 'number', description: 'Max tasks to return (default 50).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compound_workflow_run',
      description:
        'Create and start a multi-phase compound browser workflow in the background. Use this for complex chained requests requiring multiple website steps.',
      parameters: {
        type: 'object',
        properties: {
          spec: {
            type: 'object',
            description: 'Compound workflow spec with constraints and ordered phases.',
          },
          user_id: { type: 'string', description: 'Optional user/session id for ownership tracking.' },
        },
        required: ['spec'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compound_workflow_status',
      description:
        'Get status/progress/events for a compound workflow by workflow_id.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string', description: 'Workflow id returned from compound_workflow_run/create.' },
        },
        required: ['workflow_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compound_workflow_continue',
      description:
        'Continue a paused compound workflow after a checkpoint prompt.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string', description: 'Paused workflow id.' },
        },
        required: ['workflow_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compound_workflow_cancel',
      description:
        'Cancel a running or paused compound workflow.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string', description: 'Workflow id.' },
        },
        required: ['workflow_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compound_workflow_list',
      description:
        'List compound workflows with optional status filter.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Optional status filter: pending|running|paused|completed|failed|cancelled.' },
          limit: { type: 'number', description: 'Max rows to return (default 50).' },
        },
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
          mode: {
            type: 'string',
            enum: ['role', 'ai'],
            description: 'Snapshot style. Use "role" for stable refs.',
          },
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
          action: {
            type: 'string',
            enum: ['click', 'type', 'fill', 'press', 'hover', 'select', 'scroll'],
            description: 'Action type.',
          },
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
      name: 'browser_search_and_extract',
      description:
        'Run a generic, skill-driven website workflow: navigate to the skill entry URL (if needed), fill the skill-defined search input, apply optional filters, then extract structured items. Prefer this over manual browser_* steps when you want structured results.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Skill task name (e.g. salesnav_search_account, salesnav_people_search)' },
          query: { type: 'string', description: 'Search query/keywords to enter' },
          filters: { type: 'object', description: 'Optional filters: { filter_name: value }. Values may be strings or arrays.' },
          click_target: { type: 'string', description: 'Optional item label/name to click/navigate to after extraction' },
          extract_type: { type: 'string', description: 'Optional extraction kind (auto-detected from skill when omitted)' },
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
          limit: { type: 'number', description: 'Max extracted items (default 25, max 200)' },
          wait_ms: { type: 'number', description: 'Wait after search submit (ms). Use 800-2500 for most sites.' },
        },
        required: ['task', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'google_search_browser',
      description:
        'Search Google in a live browser session, wait for AI Overview if available, then return citations plus organic fallback results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Google query text' },
          tab_id: { type: 'string', description: 'Optional existing browser tab id' },
          max_results: { type: 'number', description: 'Max organic fallback results (default 5, max 20)' },
          wait_for_ai_overview_ms: { type: 'number', description: 'How long to wait for AI Overview before fallback (default 8000ms)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_list_sub_items',
      description:
        'Run a skill-driven sub-items workflow: optionally navigate to a parent item, open a sub-items view, then extract structured rows. IMPORTANT: only use args defined in this schema — do NOT add selector, css_selector, or other invented args.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Skill task name for the sub-items view (e.g. salesnav_list_employees). Must be a registered skill task — use browser_skill_list to discover available tasks.' },
          tab_id: { type: 'string', description: 'Optional tab id from browser_tabs' },
          parent_query: { type: 'string', description: 'Optional parent name to search/click before listing sub-items' },
          parent_task: { type: 'string', description: 'Optional parent task used to find the parent (e.g. salesnav_search_account)' },
          parent_filters: { type: 'object', description: 'Optional filters for the parent search step' },
          entrypoint_action: { type: 'string', description: 'Action name used to open the sub-items page (from the skill Action Hints)' },
          extract_type: { type: 'string', description: 'Extraction kind for sub-items (default lead)' },
          limit: { type: 'number', description: 'Max extracted items (default 100, max 200)' },
          wait_ms: { type: 'number', description: 'Wait after opening sub-items view (ms)' },
        },
        required: ['task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_skill_list',
      description:
        'List browser website skills stored as markdown files, optionally with best-match scoring for url/task/query.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Optional current page URL to compute best match' },
          task: { type: 'string', description: 'Optional workflow task name (for example: salesnav_search_account)' },
          query: { type: 'string', description: 'Optional user query/context to improve matching' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_skill_match',
      description:
        'Return the single best matching browser website skill for a URL/task/query triplet.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Current page URL' },
          task: { type: 'string', description: 'Task name (for example: salesnav_search_account)' },
          query: { type: 'string', description: 'User query/context' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_skill_get',
      description:
        'Get one browser website skill markdown file by skill_id, including parsed action hints.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Skill id (file name without .md)' },
        },
        required: ['skill_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_skill_upsert',
      description:
        'Create or update a browser website skill markdown file. Use this to define reusable automation behavior for any site.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Skill id (file name without .md)' },
          content: { type: 'string', description: 'Full markdown content with optional frontmatter and Action Hints section' },
        },
        required: ['skill_id', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_skill_delete',
      description:
        'Delete a browser website skill markdown file by skill_id.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Skill id (file name without .md)' },
        },
        required: ['skill_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_skill_repair',
      description:
        'Append a repair log note to a browser website skill and optionally upsert an action hint discovered during runtime.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Skill id (file name without .md)' },
          issue: { type: 'string', description: 'Short repair issue code or message' },
          context: { type: 'object', description: 'Optional key/value context for the repair note' },
          action: { type: 'string', description: 'Optional action hint key to upsert' },
          role: { type: 'string', description: 'Optional role for action hint (input/button/link/etc)' },
          text: { type: 'string', description: 'Optional visible text for action hint upsert' },
        },
        required: ['skill_id', 'issue'],
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

  // ── Workflow tools (multi-step backend operations) ──

  {
    type: 'function',
    function: {
      name: 'workflow_resolve_contact',
      description:
        'Search for a contact by name across the local database and Sales Navigator. Returns candidates from both sources plus a best-match suggestion.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Person name to search for' },
          company: { type: 'string', description: 'Company name (optional, improves matching)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workflow_enroll_and_draft',
      description:
        'Enroll a contact in a campaign and generate an email draft. Optionally creates the contact first.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID to enroll in' },
          contact_id: { type: 'number', description: 'Contact ID (if already exists)' },
          create_if_missing: {
            type: 'object',
            description: 'Contact data if the contact needs to be created first',
            properties: {
              name: { type: 'string' },
              company_name: { type: 'string' },
              title: { type: 'string' },
              email: { type: 'string' },
              linkedin_url: { type: 'string' },
            },
          },
        },
        required: ['campaign_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workflow_prospect',
      description:
        'Search for target companies via Sales Navigator. Returns company list with deduplication against existing DB companies.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query (e.g. "construction companies in New England")' },
          industry: { type: 'string', description: 'Target industry keyword' },
          location: { type: 'string', description: 'Target location' },
          max_companies: { type: 'number', description: 'Maximum companies to return', default: 10 },
          save_to_db: { type: 'boolean', description: 'Whether to save found companies to the database', default: true },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workflow_scrape_leads_batch',
      description:
        'Scrape decision-makers from multiple companies in one call. Contacts are saved to the database.',
      parameters: {
        type: 'object',
        properties: {
          company_names: {
            type: 'array',
            description: 'List of company names to scrape leads from',
            items: { type: 'string' },
          },
          title_filter: { type: 'string', description: 'Comma-separated title keywords to filter (e.g. "VP, Director, CTO")' },
          max_per_company: { type: 'number', description: 'Max leads per company', default: 5 },
        },
        required: ['company_names'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workflow_lookup_and_research',
      description:
        'Batch-lookup companies in the database and run web research + ICP assessment for each. Returns all data needed for vetting.',
      parameters: {
        type: 'object',
        properties: {
          company_names: {
            type: 'array',
            description: 'List of company names to research',
            items: { type: 'string' },
          },
          icp_context: {
            type: 'object',
            description: 'ICP context for the assessment',
            properties: {
              industry: { type: 'string' },
              location: { type: 'string' },
            },
          },
        },
        required: ['company_names'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workflow_vet_batch',
      description:
        'Record vetting decisions (approve / skip) for a batch of companies.',
      parameters: {
        type: 'object',
        properties: {
          decisions: {
            type: 'array',
            description: 'List of vetting decisions',
            items: {
              type: 'object',
              properties: {
                company_name: { type: 'string' },
                company_id: { type: 'number' },
                approved: { type: 'boolean' },
                icp_score: { type: 'number' },
              },
              required: ['company_name', 'approved'],
            },
          },
        },
        required: ['decisions'],
      },
    },
  },
];
