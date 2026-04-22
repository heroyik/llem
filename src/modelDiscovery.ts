import axios from 'axios';
import * as vscode from 'vscode';
import { normalizeAIEndpoint, stripTrailingSlash } from './aiClient';
import { _getBrainDir, getConfig, getConnectAiSettings } from './config';
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
                await getConnectAiSettings().update('ollamaUrl', 'http://127.0.0.1:1234', vscode.ConfigurationTarget.Global);
                await getConnectAiSettings().update('defaultModel', modelName, vscode.ConfigurationTarget.Global);
            }
        } catch {}

        if (!engineName) {
            try {
                const ollamaRes = await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 2000 });
                if (ollamaRes.data?.models?.length > 0) {
                    engineName = 'Ollama';
                    modelName = ollamaRes.data.models[0].name;
                    await getConnectAiSettings().update('ollamaUrl', 'http://127.0.0.1:11434', vscode.ConfigurationTarget.Global);
                    await getConnectAiSettings().update('defaultModel', modelName, vscode.ConfigurationTarget.Global);
                }
            } catch {}
        }

        ensureDir(_getBrainDir());
        ctx.globalState.update('setupComplete', true);

        if (engineName) {
            vscode.window.showInformationMessage(`🧠 자동 설정 완료! ${engineName} 감지됨 → 모델: ${modelName}`);
        } else {
            vscode.window.showInformationMessage('🧠 Connect AI 준비 완료! LM Studio 또는 Ollama를 실행하면 자동 연결됩니다.');
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
