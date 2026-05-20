import { getModelCapabilities } from './modelDiscovery';
import type { AIEndpoint, InstalledModelInfo } from './types';

/**
 * Determines whether a model supports image (vision) input.
 * Ollama's newer Gemma family may operate multimodally even when capabilities are empty,
 * so name, family, local manifest, and /api/show are all checked via OR logic.
 */
export async function modelSupportsVision(
    modelName: string,
    endpoint: AIEndpoint,
    installedModel?: { capabilities?: string[]; family?: string }
): Promise<{ supportsVision: boolean; reason: string }> {
    if (!modelName) {
        return { supportsVision: false, reason: 'empty model name' };
    }

    // Name-based heuristic: covers models where Modelfile has no capability declared
    const lower = modelName.toLowerCase();
    const nameMatch = (
        /gemma\s*3/.test(lower) ||
        /gemma\s*4/.test(lower) ||
        lower.includes('e4b') ||
        lower.includes('26b') ||
        lower.includes('gemma4') ||
        lower.includes('gemma3') ||
        lower.includes('supergemma4') ||
        lower.includes('multimodal') ||
        lower.includes('multi-modal') ||
        lower.includes('any-to-any') ||
        lower.includes('any2any') ||
        lower.includes('mmproj') ||
        lower.includes('llava') ||
        lower.includes('vision') ||
        lower.includes(':vl') ||
        lower.includes('-vl') ||
        lower.includes('_vl') ||
        lower.includes('bakllava') ||
        lower.includes('moondream') ||
        lower.includes('minicpm-v') ||
        lower.includes('cogvlm') ||
        lower.includes('qwen-vl') ||
        lower.includes('internvl')
    );

    if (nameMatch) {
        return { supportsVision: true, reason: 'matched model name heuristic' };
    }

    if (installedModel?.capabilities?.includes('vision')) {
        return { supportsVision: true, reason: 'installed model metadata includes vision capability' };
    }

    if (typeof installedModel?.family === 'string') {
        const family = installedModel.family.toLowerCase();
        if (
            family.includes('vision') ||
            family.includes('gemma4') ||
            family.includes('gemma3') ||
            /gemma\s*4/.test(family) ||
            /gemma\s*3/.test(family) ||
            family.includes('multimodal') ||
            family.includes('multi-modal') ||
            family.includes('any-to-any') ||
            family.includes('any2any') ||
            family.includes('mmproj') ||
            family.includes('llava') ||
            family.includes('moondream')
        ) {
            return { supportsVision: true, reason: `installed model family matched '${installedModel.family}'` };
        }
    }

    // API check: Ollama capabilities for models not caught by name
    if (!endpoint.isLMStudio) {
        const endpointBaseUrl = endpoint.apiUrl.replace(/\/api\/chat$/, '');
        const caps = await getModelCapabilities(modelName, endpointBaseUrl);
        if (caps.includes('vision')) {
            return { supportsVision: true, reason: 'ollama show/api capabilities include vision' };
        }
        return { supportsVision: false, reason: `no vision signal from name, metadata, or ollama capabilities (${caps.join(', ') || 'empty'})` };
    }

    return { supportsVision: false, reason: 'no vision signal from name or installed metadata under LM Studio mode' };
}
