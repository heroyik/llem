import type { AttachedFile, QueueRequestKind, QueuedRequest } from './types';

function normalizeText(value: string): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function stripInternalSystemHints(prompt: string): string {
    return String(prompt || '')
        .replace(/\s*\[SYSTEM HINT\][\s\S]*?(?=\n\n\S|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * B-4: 프롬프트 앞 300자를 추가로 사용해 fingerprint를 강화.
 * AI가 표현을 조금씩 바꿔도 같은 요청으로 감지할 수 있도록
 * 핵심 단어만 남기는 정규화를 적용한다.
 */
function normalizePromptCore(prompt: string): string {
    return stripInternalSystemHints(prompt)
        .toLowerCase()
        .replace(/[^a-z0-9가-힣\s]/g, '') // 구두점·특수문자 제거
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300); // 앞 300자만 사용 (핵심 의도 포함)
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
        normalizeText(input.modelName || ''),
        input.internetEnabled ? 'web:on' : 'web:off',
        typeof input.messageIndex === 'number' ? `msg:${input.messageIndex}` : 'msg:none',
        fingerprintFiles(input.files),
        // B-4: 정규화된 프롬프트 핵심(앞 300자)을 별도 필드로 포함
        normalizePromptCore(input.prompt)
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
