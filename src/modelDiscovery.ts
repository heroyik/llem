import axios from 'axios';
import * as vscode from 'vscode';
import { normalizeAIEndpoint, stripTrailingSlash } from './aiClient';
import { getConfig, getLlemSettings, getVaultDir } from './config';
import { ensureDir } from './fsUtils';

export async function runFirstRunSetup(ctx: vscode.ExtensionContext): Promise<void> {
    try {
        let engineName = '';
        let modelName = '';

        try {
            const lmRes = await axios.get('http://127.0.0.1:1234/v1/models', { timeout: 2000 });
            if (lmRes.data?.data?.length > 0) {
                engineName = 'LM Studio';
                modelName = lmRes.data.data[0].id;
                await getLlemSettings().update('engineUrl', 'http://127.0.0.1:1234', vscode.ConfigurationTarget.Global);
                await getLlemSettings().update('defaultModel', modelName, vscode.ConfigurationTarget.Global);
            }
        } catch {}

        if (!engineName) {
            try {
                const ollamaRes = await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 2000 });
                if (ollamaRes.data?.models?.length > 0) {
                    engineName = 'Ollama';
                    modelName = ollamaRes.data.models[0].name;
                    await getLlemSettings().update('engineUrl', 'http://127.0.0.1:11434', vscode.ConfigurationTarget.Global);
                    await getLlemSettings().update('defaultModel', modelName, vscode.ConfigurationTarget.Global);
                }
            } catch {}
        }

        ensureDir(getVaultDir());
        ctx.globalState.update('setupComplete', true);

        if (engineName) {
            vscode.window.showInformationMessage(`LLeM found ${engineName} and locked onto ${modelName}. You're good to roll.`);
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
        if (!models.includes(defaultModel)) {
            models.unshift(defaultModel);
        }
        return models;
    } catch {
        return [defaultModel];
    }
}
