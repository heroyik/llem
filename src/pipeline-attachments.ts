import { allocateAttachmentPreview, getAttachmentBudgetLimits } from './promptBudgeting';
import { attachImagesToChatMessages } from './imageRequestPayload';
import { logInfo } from './logger';
import type { AIEndpoint, AttachedFile, ChatMessage, ModelProfile } from './types';
import {
    decodeBase64TextPrefix,
    estimateBase64Bytes,
    formatBytes,
    normalizeImageData,
    sliceBase64Prefix
} from './pipeline-utils';

export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_CHARS = 20000;
export const MAX_TEXT_ATTACHMENT_DECODE_BYTES = 96 * 1024;

export interface PreparedAttachments {
    fileContext: string;
    imageFiles: AttachedFile[];
    displayFiles: Pick<AttachedFile, 'name' | 'type' | 'data'>[];
    notices: string[];
    textAttachmentNames: string[];
    includedChars: number;
    prunedChars: number;
}

export function prepareAttachments(files: AttachedFile[], modelProfile: ModelProfile): PreparedAttachments {
    const prepared: PreparedAttachments = {
        fileContext: '',
        imageFiles: [],
        displayFiles: [],
        notices: [],
        textAttachmentNames: [],
        includedChars: 0,
        prunedChars: 0
    };
    const attachmentBudget = getAttachmentBudgetLimits(modelProfile.contextBudget);
    let remainingAttachmentChars = attachmentBudget.totalChars;

    for (const file of files) {
        const type = file.type || 'application/octet-stream';
        const size = file.originalSize ?? estimateBase64Bytes(file.data);

        if (type.startsWith('image/')) {
            const imageData = normalizeImageData(file.data);
            if (!imageData) {
                prepared.displayFiles.push({ name: file.name, type, data: '' });
                prepared.notices.push(`\n\n> 📎 **[Image skipped]** ${file.name}: the pasted image data was empty before the model request.\n\n`);
                logInfo(`[PIPELINE] Skipped image attachment '${file.name}' because data was empty.`);
                continue;
            }
            if (size > MAX_IMAGE_ATTACHMENT_BYTES) {
                prepared.displayFiles.push({ name: file.name, type, data: '' });
                prepared.notices.push(`\n\n> 📎 **[Image skipped]** ${file.name}: ${formatBytes(size)} is too large for the model request. Max supported size is ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}.\n\n`);
                logInfo(`[PIPELINE] Skipped image attachment '${file.name}' because ${formatBytes(size)} exceeds ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}.`);
                continue;
            }

            prepared.imageFiles.push({ ...file, type, data: imageData });
            prepared.displayFiles.push({ name: file.name, type, data: imageData });
            continue;
        }

        const decoded = decodeBase64TextPrefix(file.data, MAX_TEXT_ATTACHMENT_DECODE_BYTES);
        const preview = decoded.slice(0, MAX_TEXT_ATTACHMENT_CHARS);
        const budgetedPreview = allocateAttachmentPreview(preview, remainingAttachmentChars, attachmentBudget.perFileChars);
        logInfo(`[PIPELINE] Prepared text attachment '${file.name}' type=${type} originalBytes=${size} encodedChars=${String(file.data || '').length} decodedChars=${decoded.length} previewChars=${preview.length} includedChars=${budgetedPreview.included.length} prunedChars=${budgetedPreview.prunedChars} remainingAttachmentChars=${Number.isFinite(budgetedPreview.remainingChars) ? budgetedPreview.remainingChars : 'unlimited'} truncated=${Boolean(file.truncated)}`);
        const wasTruncated = Boolean(file.truncated)
            || size > MAX_TEXT_ATTACHMENT_DECODE_BYTES
            || decoded.length > MAX_TEXT_ATTACHMENT_CHARS
            || budgetedPreview.prunedChars > 0;
        const note = wasTruncated
            ? ` (partial preview only: up to ${formatBytes(MAX_TEXT_ATTACHMENT_DECODE_BYTES)} of ${formatBytes(size)})`
            : '';

        if (budgetedPreview.included.length === 0) {
            prepared.displayFiles.push({ name: file.name, type, data: '' });
            prepared.notices.push(`\n\n> 📎 **[Attachment budget reached]** ${file.name}: skipped to keep the 26B prompt lean.\n\n`);
            prepared.prunedChars += preview.length;
            continue;
        }

        remainingAttachmentChars = budgetedPreview.remainingChars;
        prepared.textAttachmentNames.push(file.name);
        prepared.includedChars += budgetedPreview.included.length;
        prepared.prunedChars += budgetedPreview.prunedChars;
        prepared.fileContext += `\n\n[ATTACHED FILE: ${file.name}${note}]\n\`\`\`\n${budgetedPreview.included}\n\`\`\``;
        prepared.displayFiles.push({ name: file.name, type, data: '' });

        if (wasTruncated) {
            prepared.notices.push(`\n\n> 📎 **[Partial file preview]** ${file.name}: only the first ${formatBytes(MAX_TEXT_ATTACHMENT_DECODE_BYTES)} made it into model context. Full size: ${formatBytes(size)}.\n\n`);
        }
    }

    return prepared;
}

export function compactFilesForReuse(files: AttachedFile[]): AttachedFile[] | undefined {
    if (files.length === 0) {
        return undefined;
    }

    const reusableFiles: AttachedFile[] = [];

    for (const file of files) {
        const type = file.type || 'application/octet-stream';
        const size = file.originalSize ?? estimateBase64Bytes(file.data);

        if (type.startsWith('image/')) {
            if (size <= MAX_IMAGE_ATTACHMENT_BYTES) {
                reusableFiles.push({ ...file, type });
            }
            continue;
        }

        reusableFiles.push({
            ...file,
            type,
            data: size > MAX_TEXT_ATTACHMENT_DECODE_BYTES
                ? sliceBase64Prefix(file.data, MAX_TEXT_ATTACHMENT_DECODE_BYTES)
                : file.data,
            truncated: file.truncated || size > MAX_TEXT_ATTACHMENT_DECODE_BYTES,
            originalSize: size
        });
    }

    return reusableFiles.length > 0 ? reusableFiles : undefined;
}

export function attachImagesToRequest(endpoint: AIEndpoint, reqMessages: ChatMessage[], imageFiles: AttachedFile[]): void {
    attachImagesToChatMessages(endpoint, reqMessages, imageFiles);
}
