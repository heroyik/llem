import axios from 'axios';
import * as vscode from 'vscode';
import { normalizeAIEndpoint, stripTrailingSlash } from './aiClient';
import { getConfig, getLlemSettings, getVaultDir } from './config';
import { ensureDir } from './fsUtils';

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
            
            // Prioritize gemma4:e4b if discovered, otherwise use the first one
            let targetDefault = discoveredModels.find(m => m === 'gemma4:e4b' || m === 'gemma:latest') || discoveredModels[0];
            
            // For this specific update, we want to FORCE gemma4:e4b if it's available
            if (discoveredModels.includes('gemma4:e4b')) {
                targetDefault = 'gemma4:e4b';
            }

            if (targetDefault) {
                await getLlemSettings().update('defaultModel', targetDefault, vscode.ConfigurationTarget.Global);
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
        const endpoint = normalizeAIEndpoint(ollamaBase);
        let models: string[] = [];

        if (endpoint.isLMStudio) {
            const modelsUrl = endpoint.apiUrl.replace('/chat/completions', '/models');
            const res = await axios.get(modelsUrl, { timeout: 3000 });
            models = res.data.data.map((model: any) => model.id);
        } else {
            const res = await axios.get(`${stripTrailingSlash(ollamaBase)}/api/tags`, { timeout: 3000 });
            models = res.data.models.map((model: any) => model.name);
        }

        if (models.length === 0) {
            return [defaultModel];
        }
        
        // Ensure defaultModel is always first in the list
        // Normalize comparison to handle potential case/tag mismatches if needed, 
        // but for now we stick to exact match as per user request.
        if (models.includes(defaultModel)) {
            models = [defaultModel, ...models.filter(m => m !== defaultModel)];
        } else {
            // If the configured default isn't in the list, we still put it at the top
            // to ensure it shows up in the UI as the active selection.
            models = [defaultModel, ...models];
        }
        
        return models;
    } catch {
        return [defaultModel];
    }
}
