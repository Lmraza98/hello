/**
 * @deprecated Legacy workflow engine — prefer assistant-core skills for new capabilities.
 *
 * This engine is still used for slash-command workflows and will be maintained
 * until all workflows are migrated to the skill system.  New feature work
 * should add skills in `assistant-core/skills/handlers/` instead.
 *
 * Migration tracker:
 *   Migrated:  campaign-create-and-enroll, prospect-companies-and-draft-emails
 *   Remaining: status_check, contact_lookup, contact_outreach, campaign_list,
 *              conversation_list, lead_generation, company_research, check_job, help
 */

import type {
  BackgroundTask,
  ChatMessage,
  ParsedIntent,
  StepResult,
  Workflow,
} from '../types/chat';
import { api } from '../api';
import { parseIntent } from './intentParser';
import { statusMsg, textMsg } from './messageHelpers';
import { createCampaignListWorkflow } from './workflows/campaignList';
import { createCheckJobWorkflow } from './workflows/checkJob';
import { createCompanyResearchWorkflow } from './workflows/companyResearch';
import { createContactLookupWorkflow } from './workflows/contactLookup';
import { createContactOutreachWorkflow } from './workflows/contactOutreach';
import { createConversationListWorkflow } from './workflows/conversationList';
import { createHelpWorkflow } from './workflows/help';
import { createLeadGenerationWorkflow } from './workflows/leadGeneration';
import { createStatusCheckWorkflow } from './workflows/statusCheck';

export interface EngineResult {
  messages: ChatMessage[];
  workflow: Workflow | null;
  expandSection?: string;
  openBrowserViewer?: boolean;
  closeBrowserViewer?: boolean;
}

/**
 * Callbacks that workflow steps can use to push UI changes immediately,
 * without waiting for the entire step chain to finish.
 */
export interface EngineCallbacks {
  /** Append messages to the chat right now (before the step returns). */
  emitMessages?: (messages: ChatMessage[]) => void;
  /** Open the browser viewer right now. */
  openBrowserViewer?: () => void;
}

export async function processMessage(
  message: string,
  activeWorkflow: Workflow | null,
  dashboardData?: {
    recentReplies?: any[];
    stats?: any;
    emailStats?: any;
    backgroundTasks?: BackgroundTask[];
  },
  callbacks?: EngineCallbacks
): Promise<EngineResult> {
  if (activeWorkflow && activeWorkflow.status === 'waiting_user') {
    injectCallbacks(activeWorkflow, callbacks);
    return resumeWorkflow(activeWorkflow, message);
  }

  const parsed = parseIntent(message);
  const workflow = createWorkflow(parsed, dashboardData);

  if (!workflow) {
    return {
      messages: [textMsg('I am not sure what you mean by that. Try "help" to see what I can do.')],
      workflow: null,
    };
  }

  injectCallbacks(workflow, callbacks);
  return runWorkflow(workflow);
}

export async function processAction(
  actionValue: string,
  activeWorkflow: Workflow | null,
  callbacks?: EngineCallbacks
): Promise<EngineResult> {
  // -- Context action from a contact card --
  if (actionValue.startsWith('contact_action:')) {
    const [, action, contactIdStr] = actionValue.split(':');
    return handleContactAction(action, parseInt(contactIdStr, 10));
  }

  // -- Section button clicks are handled in the UI layer --
  if (actionValue.startsWith('section:')) {
    return { messages: [], workflow: null };
  }

  // -- Resume active workflow --
  if (activeWorkflow && activeWorkflow.status === 'waiting_user') {
    injectCallbacks(activeWorkflow, callbacks);
    return resumeWorkflow(activeWorkflow, actionValue);
  }

  return {
    messages: [textMsg('That action is no longer available.')],
    workflow: null,
  };
}

/** Thread UI callbacks into the workflow context so steps can use them. */
function injectCallbacks(workflow: Workflow, callbacks?: EngineCallbacks) {
  if (callbacks?.emitMessages) {
    workflow.context._emitMessages = callbacks.emitMessages;
  }
  if (callbacks?.openBrowserViewer) {
    workflow.context._openBrowserViewer = callbacks.openBrowserViewer;
  }
}

async function handleContactAction(
  action: string,
  contactId: number
): Promise<EngineResult> {
  switch (action) {
    case 'add_to_campaign': {
      const workflow = createContactOutreachWorkflow('', '');
      // Pre-load the contact into context so it skips the lookup step
      workflow.context.contact = { id: contactId };
      workflow.currentStepIndex = 2; // Jump to campaign selection
      return runWorkflow(workflow);
    }

    case 'send_email': {
      try {
        const contact = await api.getContact(contactId);
        const emailValue = (contact.email || '').trim();
        if (!emailValue) {
          return {
            messages: [
              statusMsg(
                `Cannot send yet for contact #${contactId}: no email is saved.`,
                'info'
              ),
              textMsg('Use "Sync to SF" or collect an email for this contact, then try send email again.'),
              {
                id: `email-missing-actions-${Date.now()}`,
                type: 'action_buttons',
                sender: 'bot',
                content: 'Choose next step:',
                timestamp: new Date(),
                buttons: [
                  { label: 'Run Email Discovery', value: `email_discovery_for_contact:${contactId}`, variant: 'primary' },
                  { label: 'Retry Send', value: `retry_send_email_contact:${contactId}`, variant: 'secondary' },
                  { label: 'Cancel', value: 'dismiss_email_discovery', variant: 'danger' },
                ],
              },
            ],
            workflow: null,
          };
        }
        const result = await api.sendEmailsToContacts([contactId]);
        const sent = Number(result.sent ?? result.processed ?? 0);
        const total = Number(result.total ?? 1);
        return {
          messages: [
            statusMsg(
              sent > 0
                ? `Email send started via Salesforce for contact #${contactId} (${sent}/${total}).`
                : `No email was sent for contact #${contactId}.`,
              sent > 0 ? 'success' : 'info'
            ),
            ...(result.message ? [textMsg(result.message)] : []),
          ],
          workflow: null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send email';
        return {
          messages: [statusMsg(`Failed to send email for contact #${contactId}: ${message}`, 'error')],
          workflow: null,
        };
      }
    }

    case 'view_in_salesforce':
      return {
        messages: [textMsg('Opening Salesforce...')],
        workflow: null,
      };

    case 'sync_salesforce':
      return {
        messages: [statusMsg(`Queued Salesforce sync for contact #${contactId}.`, 'info')],
        workflow: null,
      };

    case 'delete_contact':
      try {
        await api.deleteContact(contactId);
        return {
          messages: [statusMsg(`Deleted contact #${contactId}.`, 'success')],
          workflow: null,
        };
      } catch {
        return {
          messages: [statusMsg(`Failed to delete contact #${contactId}.`, 'error')],
          workflow: null,
        };
      }

    default:
      return {
        messages: [textMsg(`Action "${action}" is not implemented yet.`)],
        workflow: null,
      };
  }
}

function createWorkflow(
  parsed: ParsedIntent,
  dashboardData?: {
    recentReplies?: any[];
    stats?: any;
    emailStats?: any;
    backgroundTasks?: BackgroundTask[];
  }
): Workflow | null {
  switch (parsed.intent) {
    case 'status_check':
      return createStatusCheckWorkflow();
    case 'contact_lookup':
      return createContactLookupWorkflow(
        parsed.entities.person_name,
        parsed.entities.company_name
      );
    case 'contact_outreach':
      return createContactOutreachWorkflow(
        parsed.entities.person_name,
        parsed.entities.company_name
      );
    case 'campaign_list':
      return createCampaignListWorkflow();
    case 'conversation_list':
      return createConversationListWorkflow(dashboardData?.recentReplies || []);
    case 'lead_generation':
      return createLeadGenerationWorkflow(parsed.entities);
    case 'company_research':
      return createCompanyResearchWorkflow(parsed.entities.company_name);
    case 'check_job':
      return createCheckJobWorkflow(dashboardData?.backgroundTasks || []);
    case 'help':
      return createHelpWorkflow();
    case 'unknown':
    default:
      return null;
  }
}

async function runWorkflow(workflow: Workflow): Promise<EngineResult> {
  const allMessages: ChatMessage[] = [];
  let expandSection: string | undefined;
  let openBrowserViewer = false;
  let closeBrowserViewer = false;

  while (workflow.currentStepIndex < workflow.steps.length) {
    const step = workflow.steps[workflow.currentStepIndex];
    workflow.context._currentStepIndex = workflow.currentStepIndex;

    let result: StepResult;
    try {
      result = await step.execute(workflow.context);
    } catch {
      result = {
        success: false,
        messages: [statusMsg(`Step "${step.name}" failed unexpectedly.`, 'error')],
        done: true,
      };
    }

    allMessages.push(...result.messages);

    if (result.data) {
      Object.assign(workflow.context, result.data);
    }

    if (result.expandSection) {
      expandSection = result.expandSection;
    }
    if (result.openBrowserViewer) {
      openBrowserViewer = true;
    }
    if (result.closeBrowserViewer) {
      closeBrowserViewer = true;
    }

    if (result.done) {
      workflow.status = result.success ? 'completed' : 'failed';

      // Check if the workflow wants to hand off to a new workflow
      if (workflow.context._switchToWorkflow) {
        const newWorkflow = workflow.context._switchToWorkflow as Workflow;
        injectCallbacks(newWorkflow, {
          emitMessages: workflow.context._emitMessages,
          openBrowserViewer: workflow.context._openBrowserViewer,
        });
        const continued = await runWorkflow(newWorkflow);
        return {
          messages: [...allMessages, ...continued.messages],
          workflow: continued.workflow,
          expandSection: continued.expandSection || expandSection,
          openBrowserViewer: openBrowserViewer || Boolean(continued.openBrowserViewer),
          closeBrowserViewer: closeBrowserViewer || Boolean(continued.closeBrowserViewer),
        };
      }

      return {
        messages: allMessages,
        workflow: null,
        expandSection,
        openBrowserViewer,
        closeBrowserViewer,
      };
    }

    if (result.waitForUser) {
      workflow.status = 'waiting_user';
      workflow.currentStepIndex =
        result.nextStepIndex !== undefined
          ? result.nextStepIndex
          : workflow.currentStepIndex;
      return {
        messages: allMessages,
        workflow,
        expandSection,
        openBrowserViewer,
        closeBrowserViewer,
      };
    }

    workflow.currentStepIndex =
      result.nextStepIndex !== undefined
        ? result.nextStepIndex
        : workflow.currentStepIndex + 1;
  }

  workflow.status = 'completed';
  return {
    messages: allMessages,
    workflow: null,
    expandSection,
    openBrowserViewer,
    closeBrowserViewer,
  };
}

async function resumeWorkflow(
  workflow: Workflow,
  userInput: string
): Promise<EngineResult> {
  const step = workflow.steps[workflow.currentStepIndex];
  const allMessages: ChatMessage[] = [];
  let expandSection: string | undefined;
  let openBrowserViewer = false;
  let closeBrowserViewer = false;

  workflow.context._currentStepIndex = workflow.currentStepIndex;

  let result: StepResult;
  try {
    result = await step.execute(workflow.context, userInput);
  } catch {
    result = {
      success: false,
      messages: [statusMsg(`Step "${step.name}" failed.`, 'error')],
      done: true,
    };
  }

  allMessages.push(...result.messages);

  if (result.data) {
    Object.assign(workflow.context, result.data);
  }

  if (result.expandSection) {
    expandSection = result.expandSection;
  }
  if (result.openBrowserViewer) {
    openBrowserViewer = true;
  }
  if (result.closeBrowserViewer) {
    closeBrowserViewer = true;
  }

  if (result.done) {
    workflow.status = result.success ? 'completed' : 'failed';

    // Check if the workflow wants to hand off to a new workflow
    if (workflow.context._switchToWorkflow) {
      const newWorkflow = workflow.context._switchToWorkflow as Workflow;
      injectCallbacks(newWorkflow, {
        emitMessages: workflow.context._emitMessages,
        openBrowserViewer: workflow.context._openBrowserViewer,
      });
      const continued = await runWorkflow(newWorkflow);
      return {
        messages: [...allMessages, ...continued.messages],
        workflow: continued.workflow,
        expandSection: continued.expandSection || expandSection,
        openBrowserViewer: openBrowserViewer || Boolean(continued.openBrowserViewer),
        closeBrowserViewer: closeBrowserViewer || Boolean(continued.closeBrowserViewer),
      };
    }

    return {
      messages: allMessages,
      workflow: null,
      expandSection,
      openBrowserViewer,
      closeBrowserViewer,
    };
  }

  if (result.waitForUser) {
    workflow.status = 'waiting_user';
    if (result.nextStepIndex !== undefined) {
      workflow.currentStepIndex = result.nextStepIndex;
    }
    return {
      messages: allMessages,
      workflow,
      expandSection,
      openBrowserViewer,
      closeBrowserViewer,
    };
  }

  workflow.currentStepIndex =
    result.nextStepIndex !== undefined
      ? result.nextStepIndex
      : workflow.currentStepIndex + 1;
  workflow.status = 'running';

  const continued = await runWorkflow(workflow);
  return {
    messages: [...allMessages, ...continued.messages],
    workflow: continued.workflow,
    expandSection: continued.expandSection || expandSection,
    openBrowserViewer: openBrowserViewer || Boolean(continued.openBrowserViewer),
    closeBrowserViewer: closeBrowserViewer || Boolean(continued.closeBrowserViewer),
  };
}
