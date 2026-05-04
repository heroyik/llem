import axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeAIEndpoint, stripTrailingSlash } from './aiClient';
import { getConfig, getLlemSettings, getVaultDir } from './config';
import { ensureDir } from './fsUtils';
import type { InstalledModelInfo } from './types';

const MODEL_CATALOG_CACHE_TTL_MS = 60_000;
const MODEL_CAPS_CACHE_TTL_MS = 60_000;
const KNOWN_VISION_FAMILIES = [
    'gemma3',
    'gemma4',
    'llava',
    'bakllava',
    'moondream',
    'minicpm-v',
    'cogvlm',
    'qwen-vl',
    'qwen2-vl',
    'qwen2.5-vl',
    'internvl',
    'llama3.2-vision'
];

let modelCatalogCache: { baseUrl: string; models: InstalledModelInfo[]; expiresAt: number } | undefined;
const modelCapabilitiesCache = new Map<string, { capabilities: string[]; expiresAt: number }>();

function extractBaseUrlForShow(baseUrl: string): string {
    const normalized = stripTrailingSlash(baseUrl);
    return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized;
}

function normalizeCapabilities(payload: any): string[] {
    const candidates = [
        ...(Array.isArray(payload?.capabilities) ? payload.capabilities : []),
        ...(Array.isArray(payload?.details?.capabilities) ? payload.details.capabilities : [])
    ];
    const lowered = candidates
        .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(value => value.toLowerCase());

    const hasVisionSignal = lowered.includes('vision')
        || typeof payload?.projector_info === 'object'
        || typeof payload?.model_info?.['general.architecture'] === 'string' && payload.model_info['general.architecture'].toLowerCase().includes('vision')
        || Array.isArray(payload?.details?.families) && payload.details.families.some((family: unknown) => typeof family === 'string' && family.toLowerCase().includes('vision'));

    return hasVisionSignal && !lowered.includes('vision')
        ? [...lowered, 'vision']
        : lowered;
}

function inferVisionCapabilityFromStrings(values: Array<string | undefined>): boolean {
    const haystack = values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(value => value.toLowerCase());

    return haystack.some(value =>
        value.includes('vision')
        || value.includes('llava')
        || value.includes('bakllava')
        || value.includes('moondream')
        || value.includes('minicpm-v')
        || value.includes('cogvlm')
        || value.includes('qwen-vl')
        || value.includes('qwen2-vl')
        || value.includes('qwen2.5-vl')
        || value.includes('internvl')
        || value.includes('llama3.2-vision')
        || KNOWN_VISION_FAMILIES.includes(value)
    );
}

function getLocalOllamaModelsRoot(): string {
    return process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models');
}

function getManifestRoot(): string {
    return path.join(getLocalOllamaModelsRoot(), 'manifests');
}

function getBlobPath(digest: string): string {
    return path.join(getLocalOllamaModelsRoot(), 'blobs', digest.replace(':', '-'));
}

function walkFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(fullPath));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}

function parseManifestModelName(manifestPath: string, manifestRoot: string): string {
    const rel = path.relative(manifestRoot, manifestPath);
    const parts = rel.split(path.sep).filter(Boolean);
    if (parts.length < 3) {
        return rel.replace(/\\/g, '/');
    }

    const registry = parts.shift();
    const tag = parts.pop() || 'latest';
    const repo = parts.join('/');
    const fullRepo = registry === 'registry.ollama.ai'
        ? repo
        : `${registry}/${repo}`;

    return `${fullRepo}:${tag}`;
}

function readJsonFile<T>(filePath: string): T | undefined {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch {
        return undefined;
    }
}

function getLocalManifestCatalog(): InstalledModelInfo[] {
    const manifestRoot = getManifestRoot();
    if (!fs.existsSync(manifestRoot)) {
        return [];
    }

    const manifestPaths = walkFiles(manifestRoot);
    const models: InstalledModelInfo[] = [];

    for (const manifestPath of manifestPaths) {
        const manifest = readJsonFile<any>(manifestPath);
        if (!manifest?.config?.digest) {
            continue;
        }

        const config = readJsonFile<any>(getBlobPath(manifest.config.digest));
        const family = config?.model_family || config?.renderer || config?.parser;
        const modelFamilies = Array.isArray(config?.model_families)
            ? config.model_families.filter((value: unknown): value is string => typeof value === 'string')
            : [];

        const supportsVision = inferVisionCapabilityFromStrings([
            parseManifestModelName(manifestPath, manifestRoot),
            family,
            config?.renderer,
            config?.parser,
            ...modelFamilies
        ]);

        models.push({
            name: parseManifestModelName(manifestPath, manifestRoot),
            parameterSize: config?.model_type,
            family,
            capabilities: supportsVision ? ['vision'] : []
        });
    }

    return models;
}

/**
 * Query Ollama `/api/show` to get a model's declared capabilities.
 * Returns an array like ['completion', 'vision', 'audio', 'tools', 'thinking'].
 * Falls back to an empty array on error (e.g., LM Studio, network issue).
 */
export async function getModelCapabilities(modelName: string, baseUrl = getConfig().ollamaBase): Promise<string[]> {
    const cacheKey = `${baseUrl}::${modelName}`;
    const now = Date.now();
    const cached = modelCapabilitiesCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.capabilities;
    }

    try {
        const url = `${extractBaseUrlForShow(baseUrl)}/api/show`;
        const res = await axios.post(url, { name: modelName }, { timeout: 3000 });
        const caps = normalizeCapabilities(res.data);
        modelCapabilitiesCache.set(cacheKey, { capabilities: caps, expiresAt: now + MODEL_CAPS_CACHE_TTL_MS });
        return caps;
    } catch {
        const localMatch = getLocalManifestCatalog().find(model => model.name === modelName);
        return localMatch?.capabilities ?? [];
    }
}

export async function runFirstRunSetup(ctx: vscode.ExtensionContext): Promise<void> {
    try {
        let engineUrl = '';
        let discoveredModels: string[] = [];

        // Check LM Studio
        try {
            const lmRes = await axios.get('http://127.0.0.1:1234/v1/models', { timeout: 2000 });
            if (lmRes.data?.data?.length > 0) {
                engineUrl = 'http://127.0.0.1:1234';
                discoveredModels = lmRes.data.data.map((m: any) => m.id);
            }
        } catch {}

        // Check Ollama
        if (!engineUrl) {
            try {
                const ollamaRes = await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 2000 });
                if (ollamaRes.data?.models?.length > 0) {
                    engineUrl = 'http://127.0.0.1:11434';
                    discoveredModels = ollamaRes.data.models.map((m: any) => m.name);
                }
            } catch {}
        }

        if (engineUrl) {
            await getLlemSettings().update('engineUrl', engineUrl, vscode.ConfigurationTarget.Global);
            
            // Select a sane default model from the discovered list.
            // We look for 'gemma4:e4b' (preferred), then 'gemma:latest', then just the first one.
            const targetDefault = discoveredModels.find(m => m === 'gemma4:e4b') 
                               || discoveredModels.find(m => m === 'gemma:latest')
                               || discoveredModels[0];

            if (targetDefault) {
                // We only update if the user hasn't explicitly set a default model yet.
                // This prevents overwriting their choice during version updates or re-runs.
                const inspection = getLlemSettings().inspect<string>('defaultModel');
                const isSetByUser = !!(inspection?.globalValue || inspection?.workspaceValue || inspection?.workspaceFolderValue);
                
                if (!isSetByUser) {
                    await getLlemSettings().update('defaultModel', targetDefault, vscode.ConfigurationTarget.Global);
                }
            }
        }

        ensureDir(getVaultDir());
        ctx.globalState.update('setupComplete', true);

        if (engineUrl) {
            const name = engineUrl.includes('1234') ? 'LM Studio' : 'Ollama';
            vscode.window.showInformationMessage(`LLeM found ${name} and hooked in. You're good to roll.`);
        } else {
            vscode.window.showInformationMessage('LLeM is on deck. Fire up LM Studio or Ollama and it will hook in automatically.');
        }
    } catch {
        ctx.globalState.update('setupComplete', true);
    }
}

export async function getInstalledModels(): Promise<string[]> {
    const { ollamaBase, defaultModel } = getConfig();
    try {
        let models = (await getInstalledModelCatalog(ollamaBase)).map(model => model.name);

        if (models.length === 0) {
            return [defaultModel];
        }

        // Ensure defaultModel is first in the list if it's actually installed.
        // If it's not installed, we don't force it to the top to avoid confusing the user.
        if (models.includes(defaultModel)) {
            models = [defaultModel, ...models.filter(m => m !== defaultModel)];
        }

        return models;
    } catch {
        return [defaultModel];
    }
}

export async function getInstalledModelCatalog(baseUrl = getConfig().ollamaBase): Promise<InstalledModelInfo[]> {
    const now = Date.now();
    if (modelCatalogCache && modelCatalogCache.baseUrl === baseUrl && modelCatalogCache.expiresAt > now) {
        return modelCatalogCache.models;
    }

    const endpoint = normalizeAIEndpoint(baseUrl);
    let models: InstalledModelInfo[] = [];

    try {
        if (endpoint.isLMStudio) {
            const modelsUrl = endpoint.apiUrl.replace('/chat/completions', '/models');
            const res = await axios.get(modelsUrl, { timeout: 3000 });
            models = (res.data.data || []).map((model: any) => ({
                name: model.id
            }));
        } else {
            const res = await axios.get(`${stripTrailingSlash(baseUrl)}/api/tags`, { timeout: 3000 });
            models = (res.data.models || []).map((model: any) => ({
                name: model.name,
                parameterSize: model.details?.parameter_size,
                family: model.details?.family,
                capabilities: normalizeCapabilities(model.details)
            }));
        }
    } catch {
        models = endpoint.isLMStudio ? [] : getLocalManifestCatalog();
    }

    modelCatalogCache = {
        baseUrl,
        models,
        expiresAt: now + MODEL_CATALOG_CACHE_TTL_MS
    };

    return models;
}
