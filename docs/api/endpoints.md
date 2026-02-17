---
summary: "Generated catalog of FastAPI endpoints from the current OpenAPI schema."
read_when:
  - You need the canonical API surface
  - You are checking request/response model coverage
title: "API Endpoint Catalog"
---

# API Endpoint Catalog

| Method | Path | Tag | Summary | Request | Response |
|---|---|---|---|---|---|
| GET | `/api/admin/costs` | admin | Get Admin Costs | - | - |
| GET | `/api/admin/logs` | admin | Get Admin Logs | - | - |
| GET | `/api/bi/companies` | bi | Get Bi Companies | - | - |
| GET | `/api/bi/companies/{company_id}` | bi | Get Bi Company Detail | - | - |
| GET | `/api/bi/errors` | bi | Get Bi Errors | - | - |
| GET | `/api/bi/events` | bi | Get Bi Events | - | - |
| GET | `/api/bi/overview` | bi | Get Bi Overview | - | - |
| GET | `/api/bi/run/{run_id}` | bi | Get Bi Run Detail | - | - |
| GET | `/api/bi/runs` | bi | Get Bi Runs | - | - |
| GET | `/api/bi/source-config` | bi | Get Bi Source Config | - | - |
| PUT | `/api/bi/source-config` | bi | Update Bi Source Config | BiSourceConfigUpdateRequest | - |
| GET | `/api/bi/sources` | bi | Get Bi Sources | - | - |
| GET | `/api/bi/status` | bi | Get Bi Status | - | - |
| GET | `/api/bi/top-prospects` | bi | Get Bi Top Prospects | - | - |
| POST | `/api/browser/act` | browser | Browser Act | BrowserActRequest | inline |
| POST | `/api/browser/find_ref` | browser | Browser Find Ref | BrowserFindRefRequest | inline |
| GET | `/api/browser/health` | browser | Browser Health | - | inline |
| POST | `/api/browser/navigate` | browser | Browser Navigate | BrowserNavigateRequest | inline |
| POST | `/api/browser/screenshot` | browser | Browser Screenshot | BrowserScreenshotRequest | inline |
| GET | `/api/browser/skills` | browser-skills | List Browser Skills | - | - |
| POST | `/api/browser/skills/match` | browser-skills | Match Browser Skill | BrowserSkillMatchRequest | - |
| GET | `/api/browser/skills/{skill_id}` | browser-skills | Get Browser Skill | - | - |
| PUT | `/api/browser/skills/{skill_id}` | browser-skills | Put Browser Skill | BrowserSkillUpsertRequest | - |
| DELETE | `/api/browser/skills/{skill_id}` | browser-skills | Remove Browser Skill | - | - |
| POST | `/api/browser/skills/{skill_id}/repair` | browser-skills | Repair Browser Skill | BrowserSkillRepairRequest | - |
| POST | `/api/browser/snapshot` | browser | Browser Snapshot | BrowserSnapshotRequest | inline |
| GET | `/api/browser/tabs` | browser | Browser Tabs | - | inline |
| POST | `/api/browser/wait` | browser | Browser Wait | BrowserWaitRequest | inline |
| POST | `/api/browser/workflows/list-sub-items` | browser-workflows | Browser List Sub Items | ListSubItemsRequest | inline |
| POST | `/api/browser/workflows/search-and-extract` | browser-workflows | Browser Search And Extract | SearchAndExtractRequest | inline |
| GET | `/api/browser/workflows/status/{task_id}` | browser-workflows | Browser Workflow Status | - | inline |
| GET | `/api/browser/workflows/tasks` | browser-workflows | Browser Workflow Tasks | - | inline |
| POST | `/api/chat/completions` | chat | Chat Completion | ChatRequest | ChatResponse |
| POST | `/api/chat/trace` | chat | Chat Trace | ChatTraceRequest | object |
| GET | `/api/companies` | companies | Get Companies | - | array |
| POST | `/api/companies` | companies | Add Company | Company | Company |
| POST | `/api/companies/bulk-delete` | companies | Bulk Delete Companies | array | CompanyBulkDeleteResponse |
| POST | `/api/companies/collect` | companies | Collect Companies | CompanyCollectionRequest | CompanyCollectResponse |
| POST | `/api/companies/import` | companies | Import Companies | Body_import_companies_api_companies_import_post | CompanyImportResponse |
| POST | `/api/companies/lookup-existing` | companies | Lookup Existing Companies | array | CompanyLookupResponse |
| DELETE | `/api/companies/pending` | companies | Clear Pending Companies | - | CompanyPendingDeleteResponse |
| GET | `/api/companies/pending-count` | companies | Get Pending Count | - | CompanyPendingCountResponse |
| POST | `/api/companies/reset` | companies | Reset Companies | - | CompanyResetResponse |
| POST | `/api/companies/skip-pending` | companies | Skip Pending Companies | - | CompanySkippedResponse |
| PUT | `/api/companies/{company_id}` | companies | Update Company | Company | Company |
| DELETE | `/api/companies/{company_id}` | companies | Delete Company | - | CompanyDeleteResponse |
| GET | `/api/companies/{company_id}/bi-profile` | companies | Get Company Bi Profile | - | CompanyBiProfileResponse |
| POST | `/api/companies/{company_id}/mark-vetted` | companies | Mark Company Vetted | - | CompanyActionResponse |
| GET | `/api/compound_workflow` | compound-workflow | List Compound Workflows | - | object |
| POST | `/api/compound_workflow/create` | compound-workflow | Create Compound Workflow | CreateWorkflowRequest | object |
| POST | `/api/compound_workflow/run` | compound-workflow | Run Compound Workflow | RunWorkflowRequest | object |
| POST | `/api/compound_workflow/{workflow_id}/cancel` | compound-workflow | Cancel Compound Workflow | - | object |
| POST | `/api/compound_workflow/{workflow_id}/continue` | compound-workflow | Continue Compound Workflow | - | object |
| POST | `/api/compound_workflow/{workflow_id}/start` | compound-workflow | Start Compound Workflow | - | object |
| GET | `/api/compound_workflow/{workflow_id}/status` | compound-workflow | Get Compound Workflow Status | - | object |
| GET | `/api/contacts` | contacts | Get Contacts | - | array |
| POST | `/api/contacts` | contacts | Add Contact | ContactCreateRequest | ContactCreateResponse |
| DELETE | `/api/contacts` | contacts | Clear Contacts | - | ContactClearResponse |
| POST | `/api/contacts/bulk-actions/collect-phone` | contacts | Bulk Collect Phone | BulkActionRequest | BulkCollectPhoneResponse |
| POST | `/api/contacts/bulk-actions/delete` | contacts | Bulk Delete Contacts | BulkActionRequest | BulkDeleteResponse |
| POST | `/api/contacts/bulk-actions/linkedin-request` | contacts | Bulk Linkedin Request | BulkActionRequest | BulkLinkedInRequestResponse |
| POST | `/api/contacts/bulk-actions/salesforce-upload` | contacts | Bulk Upload To Salesforce | BulkActionRequest | BulkSalesforceUploadResponse |
| POST | `/api/contacts/bulk-actions/send-email` | contacts | Bulk Send Email | BulkActionRequest | BulkSendEmailResponse |
| GET | `/api/contacts/export` | contacts | Export Contacts | - | - |
| POST | `/api/contacts/salesforce-auth` | contacts | Salesforce Auth Session | - | ContactSalesforceAuthResponse |
| GET | `/api/contacts/salesforce-csv/{filename}` | contacts | Download Salesforce Csv | - | - |
| GET | `/api/contacts/{contact_id}` | contacts | Get Contact | - | ContactRecord |
| DELETE | `/api/contacts/{contact_id}` | contacts | Delete Contact | - | ContactDeleteResponse |
| POST | `/api/contacts/{contact_id}/salesforce-search` | contacts | Search Salesforce | - | ContactSalesforceQueuedResponse |
| POST | `/api/contacts/{contact_id}/salesforce-skip` | contacts | Skip Salesforce | - | ContactSalesforceSimpleResponse |
| POST | `/api/contacts/{contact_id}/salesforce-url` | contacts | Save Salesforce Url | SalesforceUrlRequest | ContactSalesforceUrlResponse |
| GET | `/api/emails/active-conversations` | emails | Get Active Conversations Endpoint | - | array |
| GET | `/api/emails/campaign-schedule-summary` | emails | Get Campaign Schedule Summary | - | array |
| GET | `/api/emails/campaigns` | emails | Get Campaigns | - | array |
| POST | `/api/emails/campaigns` | emails | Create Campaign | EmailCampaignCreate | EmailCampaignRecord |
| GET | `/api/emails/campaigns/{campaign_id}` | emails | Get Campaign | - | EmailCampaignRecord |
| PUT | `/api/emails/campaigns/{campaign_id}` | emails | Update Campaign | EmailCampaignUpdate | EmailCampaignRecord |
| DELETE | `/api/emails/campaigns/{campaign_id}` | emails | Delete Campaign | - | CampaignDeleteResponse |
| POST | `/api/emails/campaigns/{campaign_id}/activate` | emails | Activate Campaign | - | CampaignStatusResponse |
| GET | `/api/emails/campaigns/{campaign_id}/contacts` | emails | Get Campaign Contacts | - | array |
| DELETE | `/api/emails/campaigns/{campaign_id}/contacts/{campaign_contact_id}` | emails | Remove Contact | - | CampaignContactRemovedResponse |
| POST | `/api/emails/campaigns/{campaign_id}/enroll` | emails | Enroll Contacts | EnrollContactsRequest | EnrollContactsResponse |
| POST | `/api/emails/campaigns/{campaign_id}/enroll-by-filter` | emails | Enroll Contacts By Filter | EnrollContactsByFilterRequest | EnrollByFilterResponse |
| POST | `/api/emails/campaigns/{campaign_id}/pause` | emails | Pause Campaign | - | CampaignStatusResponse |
| POST | `/api/emails/campaigns/{campaign_id}/salesforce-upload` | emails | Upload Campaign To Salesforce | - | CampaignSalesforceUploadResponse |
| GET | `/api/emails/campaigns/{campaign_id}/stats` | emails | Get Campaign Stats | - | EmailCampaignStatsResponse |
| GET | `/api/emails/campaigns/{campaign_id}/templates` | emails | Get Templates | - | array |
| POST | `/api/emails/campaigns/{campaign_id}/templates` | emails | Save Template | EmailTemplateCreate | array |
| POST | `/api/emails/campaigns/{campaign_id}/templates/bulk` | emails | Save Templates Bulk | array | array |
| GET | `/api/emails/config` | emails | Get Email Config | - | EmailConfigResponse |
| PUT | `/api/emails/config` | emails | Update Email Config | EmailConfigUpdateRequest | EmailConfigUpdateResponse |
| GET | `/api/emails/conversations/{contact_id}/thread` | emails | Get Conversation Thread | - | ConversationThreadResponse |
| POST | `/api/emails/conversations/{reply_id}/mark-handled` | emails | Mark Conversation Handled | - | SuccessResponse |
| GET | `/api/emails/dashboard-metrics` | emails | Get Dashboard Metrics | - | DashboardMetricsResponse |
| POST | `/api/emails/outlook/auth` | emails | Start Outlook Auth | - | OutlookAuthStartResponse |
| GET | `/api/emails/outlook/auth-status` | emails | Get Outlook Auth Status | - | OutlookAuthStatusResponse |
| POST | `/api/emails/outlook/logout` | emails | Outlook Logout | - | SuccessResponse |
| POST | `/api/emails/outlook/poll-replies` | emails | Poll Outlook Replies Endpoint | - | OutlookPollRepliesResponse |
| POST | `/api/emails/poll-tracking` | emails | Poll Tracking | - | TrackingPollResponse |
| POST | `/api/emails/prepare-batch` | emails | Prepare Batch | - | BatchPreparationResponse |
| POST | `/api/emails/preview` | emails | Preview Email | - | EmailPreviewResponse |
| POST | `/api/emails/process-scheduled` | emails | Process Scheduled | - | ProcessScheduledResponse |
| GET | `/api/emails/queue` | emails | Get Email Queue | - | array |
| GET | `/api/emails/replies` | emails | Get Replies | - | array |
| GET | `/api/emails/review-queue` | emails | Get Review Queue | - | array |
| POST | `/api/emails/review-queue/approve-all` | emails | Approve All | BulkApproveRequest | BulkApproveResponse |
| POST | `/api/emails/review-queue/approve-campaign` | emails | Approve Campaign Queue | ApproveCampaignQueueRequest | ApproveCampaignQueueResponse |
| POST | `/api/emails/review-queue/{email_id}/approve` | emails | Approve Email | anyOf | SuccessResponse |
| POST | `/api/emails/review-queue/{email_id}/reject` | emails | Reject Email | - | SuccessResponse |
| GET | `/api/emails/scheduled` | emails | Get Scheduled | - | array |
| GET | `/api/emails/scheduled-emails` | emails | Get All Scheduled | - | array |
| PUT | `/api/emails/scheduled-emails/reorder` | emails | Reorder Emails | ReorderRequest | SuccessResponse |
| PUT | `/api/emails/scheduled-emails/reschedule-by-offset` | emails | Reschedule Campaign By Offset | RescheduleCampaignOffsetRequest | RescheduleCampaignOffsetResponse |
| GET | `/api/emails/scheduled-emails/{email_id}` | emails | Get Email Detail | - | EmailDetailResponse |
| PUT | `/api/emails/scheduled-emails/{email_id}/reschedule` | emails | Reschedule Email | RescheduleRequest | SuccessResponse |
| POST | `/api/emails/scheduled-emails/{email_id}/send-now` | emails | Send Email Now | - | SendNowResponse |
| POST | `/api/emails/send` | emails | Send Campaign Emails | SendEmailsRequest | EmailSendResultResponse |
| GET | `/api/emails/sent` | emails | Get Sent Emails | - | array |
| GET | `/api/emails/stats` | emails | Get Email Stats | - | EmailCampaignStatsResponse |
| GET | `/api/emails/tracking-status` | emails | Get Tracking Status | - | TrackingStatusResponse |
| POST | `/api/google/search-browser` | google | Google Search Browser | GoogleSearchBrowserRequest | GoogleSearchBrowserResponse |
| GET | `/api/notes` | notes | List Notes | - | inline |
| POST | `/api/notes` | notes | Create Note | CreateNoteRequest | inline |
| POST | `/api/pipeline/emails` | pipeline | Run Email Discovery | - | PipelineStartedResponse |
| POST | `/api/pipeline/phones` | pipeline | Run Phone Discovery | - | PipelineStartedResponse |
| POST | `/api/pipeline/start` | pipeline | Start Pipeline | - | PipelineStartedResponse |
| GET | `/api/pipeline/status` | pipeline | Get Pipeline Status | - | PipelineStatusResponse |
| POST | `/api/pipeline/stop` | pipeline | Stop Pipeline | - | PipelineStoppedResponse |
| POST | `/api/research/company` | research | Research Company | CompanyResearchRequest | CompanyResearchResponse |
| POST | `/api/research/icp-assess` | research | Assess Icp Fit | ICPAssessRequest | ICPAssessResponse |
| POST | `/api/research/person` | research | Research Person | PersonResearchRequest | PersonResearchResponse |
| POST | `/api/research/search` | research | Search | SearchRequest | TavilySearchResponse |
| GET | `/api/salesforce/auth-status` | salesforce | Get Salesforce Auth Status | - | AuthStatusResponse |
| POST | `/api/salesforce/credentials` | salesforce | Save Salesforce Credentials | CredentialsInput | CredentialsResponse |
| DELETE | `/api/salesforce/credentials` | salesforce | Delete Salesforce Credentials | - | CredentialsResponse |
| POST | `/api/salesforce/reauth` | salesforce | Trigger Salesforce Reauth | - | ReauthResponse |
| POST | `/api/salesnav/browser/extract-companies` | salesnav | Salesnav Extract Companies | BrowserExtractCompaniesRequest | - |
| POST | `/api/salesnav/browser/extract-leads` | salesnav | Salesnav Extract Leads | BrowserExtractLeadsRequest | - |
| POST | `/api/salesnav/browser/list-employees` | salesnav | Salesnav List Employees | BrowserSalesNavListEmployeesRequest | - |
| POST | `/api/salesnav/browser/search-account` | salesnav | Salesnav Search Account | BrowserSalesNavSearchRequest | - |
| POST | `/api/salesnav/scrape-leads` | salesnav | Scrape Leads | ScrapeLeadsRequest | SalesNavScrapeLeadsResponse |
| POST | `/api/salesnav/search` | salesnav | Salesnav Person Search | SalesNavSearchRequest | SalesNavPersonSearchResponse |
| POST | `/api/salesnav/search-companies` | salesnav | Search Companies | CompanySearchRequest | SalesNavCompanySearchResponse |
| POST | `/api/search/hybrid` | search | Hybrid Search | HybridSearchRequest | HybridSearchResponse |
| POST | `/api/search/resolve` | search | Resolve Entity | ResolveEntityRequest | ResolveEntityResponse |
| GET | `/api/stats` | stats | Get Stats | - | Stats |
| POST | `/workflows/enroll-and-draft` | workflows | Enroll And Draft Endpoint | EnrollAndDraftRequest | EnrollAndDraftResponse |
| POST | `/workflows/lookup-and-research` | workflows | Lookup And Research Endpoint | LookupAndResearchRequest | LookupAndResearchResponse |
| POST | `/workflows/prospect` | workflows | Prospect Endpoint | ProspectRequest | ProspectResponse |
| POST | `/workflows/resolve-contact` | workflows | Resolve Contact Endpoint | ResolveContactRequest | ResolveContactResponse |
| POST | `/workflows/scrape-leads-batch` | workflows | Scrape Leads Batch Endpoint | ScrapeLeadsBatchRequest | ScrapeLeadsBatchResponse |
| POST | `/workflows/vet-batch` | workflows | Vet Batch Endpoint | VetBatchRequest | VetBatchResponse |
