import type { ChatMessage } from '../../types/chat';

let _counter = 0;

export function msgId(): string {
  return `msg-${Date.now()}-${++_counter}`;
}

export function textMsg(content: string): ChatMessage {
  return {
    id: msgId(),
    type: 'text',
    sender: 'bot',
    content,
    timestamp: new Date(),
  };
}

export function statusMsg(
  content: string,
  status: 'loading' | 'success' | 'error' | 'info'
): ChatMessage {
  return {
    id: msgId(),
    type: 'status',
    sender: 'bot',
    content,
    status,
    timestamp: new Date(),
  };
}

export function buttonsMsg(
  content: string,
  buttons: {
    label: string;
    value: string;
    variant?: 'primary' | 'secondary' | 'danger';
  }[]
): ChatMessage {
  return {
    id: msgId(),
    type: 'action_buttons',
    sender: 'bot',
    content,
    buttons: buttons.map((button) => ({
      ...button,
      variant: button.variant || 'primary',
    })),
    timestamp: new Date(),
  };
}
