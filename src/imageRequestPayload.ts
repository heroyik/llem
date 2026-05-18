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

export function attachImagesToChatMessages(
    endpoint: AIEndpoint,
    messages: ChatMessage[],
    imageFiles: AttachedFile[]
): void {
    if (imageFiles.length === 0 || messages.length === 0) {
        return;
    }

    const lastUserMsg = messages[messages.length - 1];
    const text = textContentOf(lastUserMsg);

    if (endpoint.engineKind === 'ollama' || !endpoint.isLMStudio) {
        messages[messages.length - 1] = {
            ...lastUserMsg,
            content: text,
            images: imageFiles.map(img => img.data)
        } as any;
        return;
    }

    const imageParts = imageFiles.map(img => {
        if (endpoint.engineKind === 'rapid-mlx') {
            return { type: 'input_image', image_url: dataUrlForImage(img) };
        }
        return { type: 'image_url', image_url: { url: dataUrlForImage(img) } };
    });

    messages[messages.length - 1] = {
        role: 'user',
        content: [
            { type: 'text', text },
            ...imageParts
        ]
    };
}
