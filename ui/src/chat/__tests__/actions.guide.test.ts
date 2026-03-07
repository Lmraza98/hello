import { describe, expect, it } from 'vitest';
import { buildChatRequest, parseAssistantResponse } from '../actions';

describe('assistant guide actions', () => {
  it('parses assistant ui flow actions from fenced JSON', () => {
    const parsed = parseAssistantResponse(`Let's create a contact.

\`\`\`json
{"actions":[{"type":"assistant_ui_start_flow","flowId":"create_contact"}]}
\`\`\``);

    expect(parsed.text).toContain("Let's create a contact.");
    expect(parsed.actions).toEqual([
      {
        type: 'assistant_ui_start_flow',
        flowId: 'create_contact',
      },
    ]);
  });

  it('parses assistant ui target actions from fenced JSON', () => {
    const parsed = parseAssistantResponse(`Let's create a contact.

\`\`\`json
{"actions":[{"type":"assistant_ui_set_target","targetId":"new-contact-button","scrollTargetId":"new-contact-button","instruction":"Click New Contact","interaction":"click","autoClick":true}]}
\`\`\``);

    expect(parsed.text).toContain("Let's create a contact.");
    expect(parsed.actions).toEqual([
      {
        type: 'assistant_ui_set_target',
        targetId: 'new-contact-button',
        scrollTargetId: 'new-contact-button',
        instruction: 'Click New Contact',
        interaction: 'click',
        autoClick: true,
      },
    ]);
  });

  it('includes the guide protocol in chat requests', () => {
    const request = buildChatRequest({
      userMessage: 'Create a contact',
      pageContext: {
        route: '/contacts',
        title: 'Contacts',
        selection: null,
        filters: {},
      } as any,
    });

    expect(request).toContain('[ASSISTANT_UI_GUIDANCE]');
    expect(request).toContain('assistant_ui_start_flow');
    expect(request).toContain('assistant_ui_set_target');
    expect(request).toContain('assistant_ui_clear');
    expect(request).toContain('[PAGE_CONTEXT]');
  });
});
