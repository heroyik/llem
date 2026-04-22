import * as vscode from 'vscode';
import { normalizeAIEndpoint } from './aiClient';
import { getConfig, getConnectAiSettings } from './config';
import { SYSTEM_PROMPT } from './prompts';

export interface SettingsCommandsHost {
    getSystemPrompt(): string;
    getTemperature(): number;
    getTopK(): number;
    getTopP(): number;
    resetConversationForSystemPromptChange(): void;
    sendModels(): Promise<void>;
    setSystemPrompt(value: string): void;
    setTemperature(value: number): void;
    setTopK(value: number): void;
    setTopP(value: number): void;
}

export async function handleSettingsMenu(host: SettingsCommandsHost): Promise<void> {
    const mainPick = await vscode.window.showQuickPick([
        { label: '⚙️ AI 엔진 변경', description: '현재: ' + (normalizeAIEndpoint(getConfig().ollamaBase).isLMStudio ? 'LM Studio' : 'Ollama'), action: 'engine' },
        { label: '🎛️ AI 파라미터 튜닝', description: `Temp: ${host.getTemperature()}, Top-P: ${host.getTopP()}, Top-K: ${host.getTopK()}`, action: 'params' },
        { label: '📝 시스템 프롬프트 설정', description: '에이전트의 기본 역할을 커스텀합니다.', action: 'prompt' }
    ], { placeHolder: '설정 메뉴' });

    if (!mainPick) return;

    if (mainPick.action === 'engine') {
        await handleEnginePick(host);
    } else if (mainPick.action === 'params') {
        await handleParameterPick(host);
    } else if (mainPick.action === 'prompt') {
        await handleSystemPromptPick(host);
    }
}

async function handleEnginePick(host: SettingsCommandsHost): Promise<void> {
    const pick = await vscode.window.showQuickPick([
        { label: 'Ollama', description: '', action: 'ollama' },
        { label: 'LM Studio', description: '', action: 'lmstudio' },
    ], { placeHolder: 'AI 엔진을 선택하세요' });

    if (!pick) return;

    const target = (pick as any).action === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234';
    await getConnectAiSettings().update('ollamaUrl', target, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`AI 엔진이 [${pick.label}] 로 변경되었습니다.`);
    await host.sendModels();
}

async function handleParameterPick(host: SettingsCommandsHost): Promise<void> {
    const paramPick = await vscode.window.showQuickPick([
        { label: `Temperature (${host.getTemperature()})`, description: '답변의 창의성 (0.0 ~ 2.0)', action: 'temp' },
        { label: `Top P (${host.getTopP()})`, description: '단어 선택 확률 (0.0 ~ 1.0)', action: 'topp' },
        { label: `Top K (${host.getTopK()})`, description: '단어 선택 범위 (1 ~ 100)', action: 'topk' },
    ], { placeHolder: '파라미터를 선택하세요' });

    if (!paramPick) return;

    if (paramPick.action === 'temp') {
        await updateNumberSetting({
            prompt: 'Temperature 값 (0.0~2.0)',
            value: host.getTemperature(),
            setValue: (value) => host.setTemperature(value),
            success: (value) => `Temperature가 ${value}로 변경되었습니다.`
        });
    } else if (paramPick.action === 'topp') {
        await updateNumberSetting({
            prompt: 'Top P 값 (0.0~1.0)',
            value: host.getTopP(),
            setValue: (value) => host.setTopP(value),
            success: (value) => `Top P가 ${value}로 변경되었습니다.`
        });
    } else if (paramPick.action === 'topk') {
        await updateNumberSetting({
            prompt: 'Top K 값 (1~100)',
            value: host.getTopK(),
            setValue: (value) => host.setTopK(value),
            success: (value) => `Top K가 ${value}로 변경되었습니다.`
        });
    }
}

async function updateNumberSetting(options: {
    prompt: string;
    value: number;
    setValue(value: number): void;
    success(value: number): string;
}): Promise<void> {
    const val = await vscode.window.showInputBox({ prompt: options.prompt, value: options.value.toString() });
    if (val && !isNaN(Number(val))) {
        const parsed = Number(val);
        options.setValue(parsed);
        vscode.window.showInformationMessage(options.success(parsed));
    }
}

async function handleSystemPromptPick(host: SettingsCommandsHost): Promise<void> {
    const val = await vscode.window.showInputBox({
        prompt: '시스템 프롬프트 (비워두면 기본값으로 초기화됩니다)',
        value: host.getSystemPrompt() === SYSTEM_PROMPT ? '' : host.getSystemPrompt(),
        ignoreFocusOut: true
    });
    if (val === undefined) {
        return;
    }

    host.setSystemPrompt(val.trim() || SYSTEM_PROMPT);
    host.resetConversationForSystemPromptChange();
    vscode.window.showInformationMessage('시스템 프롬프트가 변경되어 새 대화가 시작되었습니다.');
}
