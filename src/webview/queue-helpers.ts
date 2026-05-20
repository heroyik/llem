import { esc } from './strings';

export type QueueRequestKind = 'prompt' | 'promptWithFile' | 'editMessage' | 'regenerate';

export interface QueueRequestSummary {
  id: string;
  kind: QueueRequestKind;
  prompt: string;
  modelName: string;
  internetEnabled?: boolean;
  messageIndex?: number;
  createdAt: number;
  attachmentCount: number;
  scheduledAt?: number;
  retryCount?: number;
}

export function queueKindLabel(kind: QueueRequestKind): string {
  if (kind === 'promptWithFile') return 'Files';
  if (kind === 'editMessage') return 'Edit';
  if (kind === 'regenerate') return 'Retry';
  return 'Prompt';
}

export function queuePromptPreview(request: QueueRequestSummary): string {
  const base = String(request.prompt || '').trim();
  if (base) {
    return base.length > 120 ? base.slice(0, 117) + '...' : base;
  }
  if (request.kind === 'regenerate') {
    return 'Regenerate the last assistant reply.';
  }
  return 'Queued request';
}
