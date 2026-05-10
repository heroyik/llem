import * as vscode from 'vscode';
import { normalizeAIEndpoint } from './aiClient';
import { getConfig, getLlemSettings } from './config';
import { loadMcpServers } from './mcpConfig';
import { getMcpManager } from './mcpManager';
import { isLargeLocal26BModel } from './performanceProfiles';
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
    const config = getConfig();
    const mainPick = await vscode.window.showQuickPick([
        { label: 'Swap model engine', description: 'Current: ' + (normalizeAIEndpoint(config.ollamaBase).isLMStudio ? 'LM Studio' : 'Ollama'), action: 'engine' },
        { label: 'Tune generation', description: `Temp: ${host.getTemperature()}, Top-P: ${host.getTopP()}, Top-K: ${host.getTopK()}`, action: 'params' },
        { label: 'Performance profile', description: `Current: ${config.performancePreset}`, action: 'profile' },
        { label: 'MCP servers', description: config.mcpEnabled ? 'View imported servers and test connections' : 'Disabled', action: 'mcp' },
        { label: 'Edit system prompt', description: 'Shape LLeM’s default vibe and instructions.', action: 'prompt' }
    ], { placeHolder: 'LLeM settings' });

    if (!mainPick) return;

    if (mainPick.action === 'engine') {
        await handleEnginePick(host);
    } else if (mainPick.action === 'params') {
        await handleParameterPick(host);
    } else if (mainPick.action === 'profile') {
        await handlePerformanceProfilePick();
    } else if (mainPick.action === 'mcp') {
        await handleMcpPick();
    } else if (mainPick.action === 'prompt') {
        await handleSystemPromptPick(host);
    }
}

async function handleMcpPick(): Promise<void> {
    const config = getConfig();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const loaded = loadMcpServers({
        workspaceRoot,
        llemServers: config.mcpServers,
        sources: config.mcpConfigSources,
        extraPaths: config.mcpConfigPaths
    });
    const serverItems = loaded.servers.map(server => ({
        label: server.name,
        description: `${server.transport}${server.disabled ? ' disabled' : server.supported ? '' : ' unsupported'} · ${server.source}`,
        detail: server.warning,
        action: 'server',
        server: server.name
    }));
    const pick = await vscode.window.showQuickPick([
        { label: 'Open LLeM MCP settings', description: 'Edit settings.json', action: 'settings' },
        { label: 'Open workspace .mcp.json', description: workspaceRoot ? 'Create or edit project MCP config' : 'No workspace open', action: 'workspace' },
        ...serverItems
    ], { placeHolder: loaded.warnings.length > 0 ? loaded.warnings[0] : 'MCP servers' });

    if (!pick) {
        return;
    }
    if (pick.action === 'settings') {
        await vscode.commands.executeCommand('workbench.action.openSettingsJson');
        return;
    }
    if (pick.action === 'workspace') {
        if (!workspaceRoot) {
            vscode.window.showWarningMessage('Open a workspace folder first.');
            return;
        }
        await vscode.workspace.openTextDocument(vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.mcp.json').fsPath))
            .then(doc => vscode.window.showTextDocument(doc));
        return;
    }
    if (pick.action === 'server') {
        const manager = getMcpManager(workspaceRoot);
        const status = await manager.healthCheck((pick as any).server);
        vscode.window.showInformationMessage(status);
    }
}

async function handleEnginePick(host: SettingsCommandsHost): Promise<void> {
    const pick = await vscode.window.showQuickPick([
        { label: 'Ollama', description: '', action: 'ollama' },
        { label: 'LM Studio', description: '', action: 'lmstudio' },
    ], { placeHolder: 'Pick the local engine' });

    if (!pick) return;

    const target = (pick as any).action === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234';
    await getLlemSettings().update('engineUrl', target, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`LLeM is now pointed at ${pick.label}.`);
    await host.sendModels();
}

async function handleParameterPick(host: SettingsCommandsHost): Promise<void> {
    const paramPick = await vscode.window.showQuickPick([
        { label: `Temperature (${host.getTemperature()})`, description: 'How wild the replies can get (0.0 - 2.0)', action: 'temp' },
        { label: `Top P (${host.getTopP()})`, description: 'How wide the token pool stays (0.0 - 1.0)', action: 'topp' },
        { label: `Top K (${host.getTopK()})`, description: 'How many token candidates stay in play (1 - 100)', action: 'topk' },
    ], { placeHolder: 'Pick a setting to tweak' });

    if (!paramPick) return;

    if (paramPick.action === 'temp') {
        await updateNumberSetting({
            prompt: 'Temperature (0.0 - 2.0)',
            value: host.getTemperature(),
            setValue: (value) => host.setTemperature(value),
            success: (value) => `Temperature set to ${value}.`
        });
    } else if (paramPick.action === 'topp') {
        await updateNumberSetting({
            prompt: 'Top P (0.0 - 1.0)',
            value: host.getTopP(),
            setValue: (value) => host.setTopP(value),
            success: (value) => `Top P set to ${value}.`
        });
    } else if (paramPick.action === 'topk') {
        await updateNumberSetting({
            prompt: 'Top K (1 - 100)',
            value: host.getTopK(),
            setValue: (value) => host.setTopK(value),
            success: (value) => `Top K set to ${value}.`
        });
    }
}

async function handlePerformanceProfilePick(): Promise<void> {
    const pick = await vscode.window.showQuickPick([
        {
            label: 'auto',
            description: 'Recommended. Detect large local 26B-class models automatically.'
        },
        {
            label: 'balanced',
            description: 'Keep the current wider context and generation budget.'
        },
        {
            label: 'large-local-26b',
            description: 'Use tighter prompt and Ollama budgets for local 26B-class models.'
        }
    ], { placeHolder: 'Pick a performance profile' });

    if (!pick) {
        return;
    }

    await getLlemSettings().update('performancePreset', pick.label, vscode.ConfigurationTarget.Global);
    const config = getConfig();

    if (pick.label === 'large-local-26b' && config.timeout < 600_000) {
        vscode.window.showWarningMessage('26B local models are happiest with a request timeout of 600 seconds or higher.');
    } else if (pick.label === 'auto' && isLargeLocal26BModel(config.defaultModel) && config.timeout < 600_000) {
        vscode.window.showWarningMessage('Auto mode will treat your current default model as a 26B-class model. Consider raising request timeout to 600 seconds.');
    } else {
        vscode.window.showInformationMessage(`Performance profile set to ${pick.label}.`);
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
        prompt: 'System prompt. Leave it empty to snap back to the default.',
        value: host.getSystemPrompt() === SYSTEM_PROMPT ? '' : host.getSystemPrompt(),
        ignoreFocusOut: true
    });
    if (val === undefined) {
        return;
    }

    host.setSystemPrompt(val.trim() || SYSTEM_PROMPT);
    host.resetConversationForSystemPromptChange();
    vscode.window.showInformationMessage('System prompt updated. LLeM started a fresh thread.');
}
