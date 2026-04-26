export const MAX_BRIDGE_PROMPT_CHARS = 20_000;
export const MAX_BRIDGE_TITLE_CHARS = 160;
export const MAX_BRIDGE_MARKDOWN_CHARS = 500_000;

export class BridgePayloadError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export function readBridgePrompt(payload: unknown, fallback: string): string {
    const value = readOptionalStringField(payload, 'prompt') || fallback;
    return limitString(value, MAX_BRIDGE_PROMPT_CHARS, 'prompt');
}

export function readBridgeVaultDrop(payload: unknown): { title: string; markdown: string } {
    const title = readOptionalStringField(payload, 'title') || 'vault_drop';
    const markdown = readRequiredStringField(payload, 'markdown');
    return {
        title: limitString(title, MAX_BRIDGE_TITLE_CHARS, 'title'),
        markdown: limitString(markdown, MAX_BRIDGE_MARKDOWN_CHARS, 'markdown')
    };
}

function readOptionalStringField(payload: unknown, field: string): string {
    if (!isObjectRecord(payload)) {
        return '';
    }

    const value = payload[field];
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value !== 'string') {
        throw new BridgePayloadError(`${field} must be a string.`);
    }
    return value.trim();
}

function readRequiredStringField(payload: unknown, field: string): string {
    const value = readOptionalStringField(payload, field);
    if (!value) {
        throw new BridgePayloadError(`${field} is required.`);
    }
    return value;
}

function limitString(value: string, maxLength: number, field: string): string {
    if (value.length > maxLength) {
        throw new BridgePayloadError(`${field} is too long.`);
    }
    return value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
