import { getEngineDisplayName } from './aiClient';

export function normalizeImageData(data: unknown): string {
    const raw = String(data || '').trim();
    const dataUrlMatch = raw.match(/^data:[^;]+;base64,(.*)$/i);
    return dataUrlMatch ? dataUrlMatch[1].trim() : raw;
}

export function decodeBase64TextPrefix(base64: string, maxBytes: number): string {
    const prefix = sliceBase64Prefix(base64, maxBytes);

    if (!prefix) {
        return '';
    }

    return Buffer.from(prefix, 'base64')
        .toString('utf-8')
        .replace(/\uFFFD$/, '');
}

export function sliceBase64Prefix(base64: string, maxBytes: number): string {
    const encodedLimit = Math.max(4, Math.floor(maxBytes / 3) * 4);
    const end = Math.min(base64.length, encodedLimit);
    const alignedEnd = end - (end % 4);

    if (alignedEnd <= 0) {
        return '';
    }

    return base64.slice(0, alignedEnd);
}

export function sliceBase64Suffix(base64: string, maxBytes: number): string {
    const encodedLimit = Math.max(4, Math.floor(maxBytes / 3) * 4);
    const start = Math.max(0, base64.length - encodedLimit);
    const alignedStart = start - (start % 4);
    return base64.slice(alignedStart);
}

export function estimateBase64Bytes(base64: string): number {
    if (!base64) {
        return 0;
    }

    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes}B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)}KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function cleanHtmlText(html: string): string {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function extractChunkHint(fetchedContent: string): string {
    const match = fetchedContent.match(/use <read_file>([^<]+)<\/read_file>/i);
    return match ? match[1] : '';
}

export function isAbortError(error: any): boolean {
    return error?.name === 'AbortError'
        || error?.code === 'ERR_CANCELED'
        || error?.message === 'canceled'
        || error?.message === 'AbortError: This operation was aborted';
}

export function formatPromptWithFileError(error: any, ollamaBase: string): string {
    const targetName = getEngineDisplayName(ollamaBase);
    const isOpenAICompatible = targetName !== 'Ollama';
    const defaultPort = targetName === 'Rapid-MLX' ? '8000' : isOpenAICompatible ? '1234' : '11434';

    if (error?.name === 'ReasoningOnlyStreamError') {
        return `⚠️ ${error.message}\n\n**Try this:** switch to a non-thinking model, or make sure ${targetName} is asked to return only final answer content.`;
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        return `⚠️ Could not reach ${targetName}.\n\n**Try this:**\n1. Open ${targetName} and make sure the local server is running.\n2. Check the engine URL in Settings. Default is http://127.0.0.1:${defaultPort}.`;
    }
    if (error.response?.status === 400) {
        return `⚠️ Model request failed (400).\n\n**Usually this means:** the model name is off, or the prompt blew past the context window.\n**Try this:** pick the right model from the dropdown.\n${isOpenAICompatible ? `• In ${targetName}, make sure the model is loaded and the /v1 server is running.` : '• In Ollama, run \`ollama list\` and make sure the model exists.'}`;
    }
    if (error.response?.status === 404) {
        return `⚠️ Model not found (404).\n\nThe selected model is not available in ${targetName} right now.\n${isOpenAICompatible ? `Load it in ${targetName} first, then try again.` : 'Pull it first with \`ollama pull <model-name>\`.'}`;
    }
    if (error.response?.status === 413) {
        return '⚠️ Context limit hit (413).\n\nTry turning vault mode off for a moment, or spin up a fresh thread with `+`.';
    }
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        return '⚠️ The model timed out.\n\nTry a smaller model, a shorter prompt, or a longer request timeout.';
    }
    return `⚠️ Error: ${error.message}`;
}

export function formatPromptError(error: any, ollamaBase: string): string {
    const targetName = getEngineDisplayName(ollamaBase);

    if (error?.name === 'ReasoningOnlyStreamError') {
        return `⚠️ ${error.message}\n\nSwitch to a non-thinking model, or make sure ${targetName} returns final answer content instead of reasoning trace only.`;
    }
    if (error.code === 'ECONNREFUSED') {
        return `⚠️ Could not reach ${targetName}.\nMake sure the local server is up.`;
    }
    if (error.response?.status === 400 || error.response?.status === 413) {
        return '⚠️ Context limit hit. The prompt is too large. Start a fresh thread or trim the request.';
    }
    return `⚠️ Error: ${error.message}`;
}
