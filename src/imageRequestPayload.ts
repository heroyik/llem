import type { AIEndpoint, AttachedFile, ChatMessage } from './types';

function dataUrlForImage(image: AttachedFile): string {
    return `data:${image.type || 'image/png'};base64,${image.data}`;
}

function textContentOf(message: ChatMessage | undefined): string {
    if (!message) {
        return '';
    }
    return typeof message.content === 'string'
        ? message.content
        : String(message.content || '');
}

function findLastUserMessageIndex(messages: ChatMessage[]): number {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role === 'user') {
            return index;
        }
    }
    return -1;
}

export function attachImagesToChatMessages(
    endpoint: AIEndpoint,
    messages: ChatMessage[],
    imageFiles: AttachedFile[]
): void {
    if (imageFiles.length === 0 || messages.length === 0) {
        return;
    }

    const targetIndex = findLastUserMessageIndex(messages);
    if (targetIndex < 0) {
        return;
    }

    const lastUserMsg = messages[targetIndex];
    const text = textContentOf(lastUserMsg);

    if (endpoint.engineKind === 'ollama' || !endpoint.isLMStudio) {
        messages[targetIndex] = {
            ...lastUserMsg,
            content: text,
            images: imageFiles.map(img => img.data)
        } as any;
        return;
    }

    const imageParts = imageFiles.map(img => {
        return { type: 'image_url', image_url: { url: dataUrlForImage(img) } };
    });

    messages[targetIndex] = {
        role: 'user',
        content: [
            { type: 'text', text },
            ...imageParts
        ]
    };
}
