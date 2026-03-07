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
| POST | `/api/admin/launcher/preview-plan` | admin | Launcher Preview Plan | PlanRequest | array |
| POST | `/api/admin/launcher/run` | admin | Launcher Run | PlanRequest | object |
| GET | `/api/admin/launcher/runs` | admin | Launcher Runs | - | array |
| GET | `/api/admin/launcher/runs/{run_id}/artifacts/{kind}` | admin | Launcher Artifact | - | object |
| POST | `/api/admin/launcher/runs/{run_id}/open` | admin | Launcher Open Run | - | object |
| GET | `/api/admin/launcher/state` | admin | Launcher State | - | object |
| GET | `/api/admin/launcher/status` | admin | Launcher Status | - | object |
| POST | `/api/admin/launcher/stop` | admin | Launcher Stop | StopRequest | object |
| GET | `/api/admin/launcher/tests` | admin | Launcher Tests | - | array |
| GET | `/api/admin/logs` | admin | Get Admin Logs | - | - |
| POST | `/api/browser/act` | browser | Browser Act | BrowserActRequest | inline |
| POST | `/api/browser/find_ref` | browser | Browser Find Ref | BrowserFindRefRequest | inline |
| GET | `/api/browser/health` | browser | Browser Health | - | inline |
| POST | `/api/browser/navigate` | browser | Browser Navigate | BrowserNavigateRequest | inline |
| POST | `/api/browser/screenshot` | browser | Browser Screenshot | BrowserScreenshotRequest | inline |
| POST | `/api/browser/shutdown` | browser | Browser Shutdown | - | inline |
| GET | `/api/browser/skills` | browser-skills | List Browser Skills | - | - |
| POST | `/api/browser/skills/match` | browser-skills | Match Browser Skill | BrowserSkillMatchRequest | - |
| GET | `/api/browser/skills/{skill_id}` | browser-skills | Get Browser Skill | - | - |
| PUT | `/api/browser/skills/{skill_id}` | browser-skills | Put Browser Skill | BrowserSkillUpsertRequest | - |
| DELETE | `/api/browser/skills/{skill_id}` | browser-skills | Remove Browser Skill | - | - |
| POST | `/api/browser/skills/{skill_id}/promote` | browser-skills | Promote Browser Skill | BrowserSkillPromoteRequest | - |
| POST | `/api/browser/skills/{skill_id}/regression-run` | browser-skills | Run Browser Skill Regression | BrowserSkillRegressionRunRequest | - |
| POST | `/api/browser/skills/{skill_id}/repair` | browser-skills | Repair Browser Skill | BrowserSkillRepairRequest | - |
| POST | `/api/browser/snapshot` | browser | Browser Snapshot | BrowserSnapshotRequest | inline |
| GET | `/api/browser/tabs` | browser | Browser Tabs | - | inline |
| POST | `/api/browser/wait` | browser | Browser Wait | BrowserWaitRequest | inline |
| POST | `/api/browser/workflows/annotate-candidate` | browser-workflows | Browser Annotate Candidate | AnnotateCandidateRequest | inline |
| POST | `/api/browser/workflows/list-sub-items` | browser-workflows | Browser List Sub Items | ListSubItemsRequest | inline |
| POST | `/api/browser/workflows/observation-pack` | browser-workflows | Browser Observation Pack | ObservationPackRequest | inline |
| POST | `/api/browser/workflows/search-and-extract` | browser-workflows | Browser Search And Extract | SearchAndExtractRequest | inline |
| GET | `/api/browser/workflows/status/{task_id}` | browser-workflows | Browser Workflow Status | - | inline |
| POST | `/api/browser/workflows/synthesize-from-feedback` | browser-workflows | Browser Synthesize From Feedback | FeedbackSynthesisRequest | inline |
| GET | `/api/browser/workflows/tasks` | browser-workflows | Browser Workflow Tasks | - | inline |
| POST | `/api/browser/workflows/validate-candidate` | browser-workflows | Browser Validate Candidate | ValidateCandidateRequest | inline |
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
| POST | `/api/contacts/bulk-actions/mark-reviewed` | contacts | Bulk Mark Reviewed | BulkActionRequest | BulkMarkReviewedResponse |
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
| GET | `/api/documents` | documents | List Documents | - | - |
| POST | `/api/documents/ask` | documents | Ask Documents Route | AskDocumentsRequest | - |
| GET | `/api/documents/folders` | documents | List Document Folders | - | - |
| POST | `/api/documents/folders` | documents | Create Document Folder | CreateFolderRequest | - |
| POST | `/api/documents/folders/move` | documents | Move Document Folder | MoveFolderRequest | - |
| DELETE | `/api/documents/folders/{folder_path}` | documents | Delete Document Folder | - | - |
| PATCH | `/api/documents/folders/{folder_path}/rename` | documents | Rename Document Folder | RenameFolderRequest | - |
| POST | `/api/documents/link` | documents | Link Document To Entities | LinkDocumentRequest | - |
| POST | `/api/documents/search` | documents | Search Documents | SearchDocumentsRequest | - |
| POST | `/api/documents/upload` | documents | Upload Document | Body_upload_document_api_documents_upload_post | - |
| GET | `/api/documents/{document_id}` | documents | Get Document | - | - |
| POST | `/api/documents/{document_id}/move` | documents | Move Document | MoveDocumentRequest | - |
| PATCH | `/api/documents/{document_id}/rename` | documents | Rename Document | RenameDocumentRequest | - |
| POST | `/api/documents/{document_id}/retry` | documents | Retry Document Processing | - | - |
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
| POST | `/api/emails/campaigns/{campaign_id}/reconcile-progress` | emails | Reconcile Campaign Progress | - | CampaignProgressReconcileResponse |
| POST | `/api/emails/campaigns/{campaign_id}/salesforce-upload` | emails | Upload Campaign To Salesforce | - | CampaignSalesforceUploadResponse |
| GET | `/api/emails/campaigns/{campaign_id}/stats` | emails | Get Campaign Stats | - | EmailCampaignStatsResponse |
| POST | `/api/emails/campaigns/{campaign_id}/sync-salesforce-history` | emails | Sync Campaign Salesforce History | - | CampaignSalesforceHistorySyncResponse |
| PUT | `/api/emails/campaigns/{campaign_id}/template-link` | emails | Link Campaign Template | object | - |
| GET | `/api/emails/campaigns/{campaign_id}/templates` | emails | Get Templates | - | array |
| POST | `/api/emails/campaigns/{campaign_id}/templates` | emails | Save Template | EmailTemplateCreate | array |
| POST | `/api/emails/campaigns/{campaign_id}/templates/bulk` | emails | Save Templates Bulk | array | array |
| GET | `/api/emails/config` | emails | Get Email Config | - | EmailConfigResponse |
| PUT | `/api/emails/config` | emails | Update Email Config | EmailConfigUpdateRequest | EmailConfigUpdateResponse |
| GET | `/api/emails/contacts/{contact_id}/campaign-enrollments` | emails | Get Contact Campaign Enrollments | - | - |
| GET | `/api/emails/conversations/{contact_id}/thread` | emails | Get Conversation Thread | - | ConversationThreadResponse |
| POST | `/api/emails/conversations/{reply_id}/mark-handled` | emails | Mark Conversation Handled | - | SuccessResponse |
| GET | `/api/emails/dashboard-metrics` | emails | Get Dashboard Metrics | - | DashboardMetricsResponse |
| POST | `/api/emails/outlook/auth` | emails | Start Outlook Auth | - | OutlookAuthStartResponse |
| GET | `/api/emails/outlook/auth-status` | emails | Get Outlook Auth Status | - | OutlookAuthStatusResponse |
| GET | `/api/emails/outlook/inbound-leads/alerts` | emails | Get Inbound Lead Alerts | - | InboundLeadAlertsResponse |
| POST | `/api/emails/outlook/inbound-leads/backfill-details` | emails | Backfill Inbound Lead Details Endpoint | - | InboundLeadBackfillResponse |
| POST | `/api/emails/outlook/inbound-leads/mark-seen` | emails | Mark Inbound Leads Seen | - | InboundLeadMarkSeenResponse |
| POST | `/api/emails/outlook/inbound-leads/queue-salesforce` | emails | Queue Inbound Leads For Salesforce | - | InboundLeadQueueSalesforceResponse |
| GET | `/api/emails/outlook/inbound-leads/recent` | emails | Get Recent Inbound Leads | - | array |
| POST | `/api/emails/outlook/logout` | emails | Outlook Logout | - | SuccessResponse |
| POST | `/api/emails/outlook/poll-replies` | emails | Poll Outlook Replies Endpoint | - | OutlookPollRepliesResponse |
| GET | `/api/emails/outlook/poll-status` | emails | Get Outlook Poll Status | - | OutlookPollStatusResponse |
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
| GET | `/api/emails/template-blocks` | emails | List Blocks | - | - |
| POST | `/api/emails/template-blocks` | emails | Create Block | BlockCreateRequest | - |
| PUT | `/api/emails/template-blocks/{block_id}` | emails | Update Block | BlockUpdateRequest | - |
| DELETE | `/api/emails/template-blocks/{block_id}` | emails | Delete Block | - | - |
| GET | `/api/emails/templates` | emails | List Templates | - | - |
| POST | `/api/emails/templates` | emails | Create Template | TemplateCreateRequest | - |
| POST | `/api/emails/templates/import` | emails | Import Template | object | - |
| POST | `/api/emails/templates/validate` | emails | Validate Template | ValidateRequest | - |
| GET | `/api/emails/templates/{template_id}` | emails | Get Template | - | - |
| PUT | `/api/emails/templates/{template_id}` | emails | Update Template | TemplateUpdateRequest | - |
| POST | `/api/emails/templates/{template_id}/archive` | emails | Archive Template | - | - |
| POST | `/api/emails/templates/{template_id}/duplicate` | emails | Duplicate Template | - | - |
| GET | `/api/emails/templates/{template_id}/export` | emails | Export Template | - | - |
| POST | `/api/emails/templates/{template_id}/render` | emails | Render Template | TemplateRenderRequest | - |
| POST | `/api/emails/templates/{template_id}/revert` | emails | Revert Template | TemplateRevertRequest | - |
| GET | `/api/emails/templates/{template_id}/revisions` | emails | Template Revisions | - | - |
| POST | `/api/emails/templates/{template_id}/test-send` | emails | Test Send Template | TemplateTestSendRequest | - |
| GET | `/api/emails/tracking-status` | emails | Get Tracking Status | - | TrackingStatusResponse |
| POST | `/api/google/search-browser` | google | Google Search Browser | GoogleSearchBrowserRequest | GoogleSearchBrowserResponse |
| GET | `/api/langgraph/runs` | langgraph | List Runs | - | object |
| POST | `/api/langgraph/runs` | langgraph | Create Run | CreateRunRequest | object |
| POST | `/api/langgraph/runs/lead-research` | langgraph | Create Lead Research Run | CreateLeadResearchRunRequest | object |
| POST | `/api/langgraph/runs/{run_id}/cancel` | langgraph | Cancel Run | - | object |
| POST | `/api/langgraph/runs/{run_id}/continue` | langgraph | Continue Run | - | object |
| GET | `/api/langgraph/runs/{run_id}/evidence` | langgraph | Run Lead Evidence | - | object |
| GET | `/api/langgraph/runs/{run_id}/lead-results` | langgraph | Run Lead Results | - | object |
| POST | `/api/langgraph/runs/{run_id}/start` | langgraph | Start Run | - | object |
| GET | `/api/langgraph/runs/{run_id}/status` | langgraph | Run Status | - | RunStatusResponse |
| GET | `/api/leads/credits` | leads | Get Lead Credits | - | - |
| POST | `/api/leads/export/crm` | leads | Export Leads Crm | ExportCrmRequest | - |
| POST | `/api/leads/export/csv` | leads | Export Leads | ExportLeadsRequest | - |
| GET | `/api/leads/runs/{run_id}` | leads | Get Run Leads | - | - |
| POST | `/api/leads/save` | leads | Save Leads | SaveLeadsRequest | - |
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
