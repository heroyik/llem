import axios from 'axios';
import * as vscode from 'vscode';
import { normalizeAIEndpoint, stripTrailingSlash } from './aiClient';
import { getConfig, getLlemSettings, getVaultDir } from './config';
import { ensureDir } from './fsUtils';
import type { InstalledModelInfo } from './types';

const MODEL_CATALOG_CACHE_TTL_MS = 15_000;

let modelCatalogCache: { baseUrl: string; models: InstalledModelInfo[]; expiresAt: number } | undefined;

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
            family: model.details?.family
        }));
    }

    modelCatalogCache = {
        baseUrl,
        models,
        expiresAt: now + MODEL_CATALOG_CACHE_TTL_MS
    };

    return models;
}
