import { AssistantMessage } from './AssistantMessage';

export function AssistantBlock({ content }: { content: string }) {
  return <AssistantMessage content={content} />;
}
