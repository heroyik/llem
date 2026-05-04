import type { AttachedFile, QueueRequestKind, QueuedRequest } from './types';

function normalizeText(value: string): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function fingerprintFiles(files?: AttachedFile[]): string {
    return (files || [])
        .map(file => `${file.name}:${file.type}:${file.originalSize ?? file.data.length}`)
        .sort()
        .join('|');
}

export function buildRequestFingerprint(input: {
    kind: QueueRequestKind;
    prompt: string;
    modelName?: string;
    files?: AttachedFile[];
    internetEnabled?: boolean;
    messageIndex?: number;
}): string {
    return [
        input.kind,
        normalizeText(input.prompt),
        normalizeText(input.modelName || ''),
        input.internetEnabled ? 'web:on' : 'web:off',
        typeof input.messageIndex === 'number' ? `msg:${input.messageIndex}` : 'msg:none',
        fingerprintFiles(input.files)
    ].join('::');
}

export function buildQueuedRequestFingerprint(request: QueuedRequest): string {
    return buildRequestFingerprint({
        kind: request.kind,
        prompt: request.prompt,
        modelName: request.modelName,
        files: request.files,
        internetEnabled: request.internetEnabled,
        messageIndex: request.messageIndex
    });
}
