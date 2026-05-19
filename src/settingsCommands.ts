import * as vscode from 'vscode';
import { getEngineDisplayName } from './aiClient';
import { getConfig, getLlemSettings } from './config';
import { isLargeLocal26BModel } from './performanceProfiles';
import { SYSTEM_PROMPT } from './prompts';
import { RAPID_MLX_TEXT_SAMPLING_DEFAULTS, normalizeRapidMlxTextSampling, type RapidMlxTextSamplingSettings } from './samplingProfiles';

export interface SettingsCommandsHost {
    getRapidMlxTextSampling(): RapidMlxTextSamplingSettings;
    getSystemPrompt(): string;
    getTemperature(): number;
    getTopK(): number;
    getTopP(): number;
    resetRapidMlxTextSampling(): void;
    resetConversationForSystemPromptChange(): void;
    sendModels(): Promise<void>;
    setRapidMlxTextSampling(value: RapidMlxTextSamplingSettings): void;
    setSystemPrompt(value: string): void;
    setTemperature(value: number): void;
    setTopK(value: number): void;
    setTopP(value: number): void;
    listMcpServers?(): Promise<void>;
    reloadMcpServers?(): Promise<void>;
    syncCodexMcpServers?(): Promise<void>;
    importMcpFromGitHub?(): Promise<void>;
}

export async function handleSettingsMenu(host: SettingsCommandsHost): Promise<void> {
    const config = getConfig();
    const rapidMlx = host.getRapidMlxTextSampling();
    const mainPick = await vscode.window.showQuickPick([
        { label: 'Swap model engine', description: 'Current: ' + getEngineDisplayName(config.ollamaBase), action: 'engine' },
        { label: 'Tune generation', description: `Rapid-MLX text: T ${rapidMlx.temperature}, P ${rapidMlx.topP}, K ${rapidMlx.topK}, Repeat ${rapidMlx.repeatPenalty}, Max ${rapidMlx.maxTokens}`, action: 'params' },
        { label: 'Performance profile', description: `Current: ${config.performancePreset}`, action: 'profile' },
        { label: 'MCP servers', description: 'List, reload, sync Codex, or import from GitHub.', action: 'mcp' },
        { label: 'Edit system prompt', description: 'Shape the default vibe and instructions.', action: 'prompt' }
    ], { placeHolder: 'Settings' });

    if (!mainPick) return;

    if (mainPick.action === 'engine') {
        await handleEnginePick(host);
    } else if (mainPick.action === 'params') {
        await handleParameterPick(host);
    } else if (mainPick.action === 'profile') {
        await handlePerformanceProfilePick();
    } else if (mainPick.action === 'mcp') {
        await handleMcpPick(host);
    } else if (mainPick.action === 'prompt') {
        await handleSystemPromptPick(host);
    }
}

async function handleMcpPick(host: SettingsCommandsHost): Promise<void> {
    const pick = await vscode.window.showQuickPick([
        { label: 'List MCP servers', action: 'list' },
        { label: 'Sync Codex MCP settings', action: 'sync' },
        { label: 'Import MCP from GitHub URL', action: 'github' },
        { label: 'Reload MCP runtime', action: 'reload' }
    ], { placeHolder: 'MCP servers' });
    if (!pick) {
        return;
    }
    if (pick.action === 'list') {
        await host.listMcpServers?.();
    } else if (pick.action === 'sync') {
        await host.syncCodexMcpServers?.();
    } else if (pick.action === 'github') {
        await host.importMcpFromGitHub?.();
    } else if (pick.action === 'reload') {
        await host.reloadMcpServers?.();
    }
}

async function handleEnginePick(host: SettingsCommandsHost): Promise<void> {
    const pick = await vscode.window.showQuickPick([
        { label: 'Rapid-MLX', description: 'http://127.0.0.1:8000', action: 'rapid-mlx' },
        { label: 'Ollama', description: '', action: 'ollama' },
        { label: 'LM Studio', description: 'http://127.0.0.1:1234', action: 'lmstudio' },
    ], { placeHolder: 'Pick the local engine' });

    if (!pick) return;

    const targets: Record<string, string> = {
        'rapid-mlx': 'http://127.0.0.1:8000',
        ollama: 'http://127.0.0.1:11434',
        lmstudio: 'http://127.0.0.1:1234'
    };
    const target = targets[(pick as any).action] ?? 'http://127.0.0.1:11434';
    await getLlemSettings().update('engineUrl', target, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Now pointed at ${pick.label}.`);
    await host.sendModels();
}

async function handleParameterPick(host: SettingsCommandsHost): Promise<void> {
    const sampling = host.getRapidMlxTextSampling();
    const paramPick = await vscode.window.showQuickPick([
        { label: `Temperature (${sampling.temperature})`, description: 'Rapid-MLX text creativity/randomness (0.0 - 2.0)', action: 'rapidTemp' },
        { label: `Top P (${sampling.topP})`, description: 'Rapid-MLX text nucleus sampling width (0.0 - 1.0)', action: 'rapidTopP' },
        { label: `Top K (${sampling.topK})`, description: 'Rapid-MLX text candidate-token cap (1 - 100)', action: 'rapidTopK' },
        { label: `Repeat Penalty (${sampling.repeatPenalty})`, description: 'Rapid-MLX text anti-repetition strength (0.8 - 2.0)', action: 'rapidRepeatPenalty' },
        { label: `Max Tokens (${sampling.maxTokens})`, description: 'Rapid-MLX text maximum response length (128 - 8192)', action: 'rapidMaxTokens' },
        { label: '$(question) Explain parameters', description: 'Show detailed meaning and tradeoffs for each value.', action: 'help' },
        { label: '$(debug-restart) Reset Rapid-MLX text defaults', description: formatRapidMlxDefaults(), action: 'reset' },
        { label: `Legacy Temperature (${host.getTemperature()})`, description: 'Used by non Rapid-MLX-safe requests (0.0 - 2.0)', action: 'temp' },
        { label: `Legacy Top P (${host.getTopP()})`, description: 'Used by non Rapid-MLX-safe requests (0.0 - 1.0)', action: 'topp' },
        { label: `Legacy Top K (${host.getTopK()})`, description: 'Used by non Rapid-MLX-safe requests (1 - 100)', action: 'topk' },
    ], { placeHolder: 'Pick a setting to tweak' });

    if (!paramPick) return;

    if (paramPick.action === 'help') {
        await showSamplingHelp();
    } else if (paramPick.action === 'reset') {
        host.resetRapidMlxTextSampling();
        vscode.window.showInformationMessage(`Rapid-MLX text parameters reset to defaults: ${formatRapidMlxDefaults()}.`);
    } else if (paramPick.action === 'rapidTemp') {
        await updateRapidMlxTextSetting(host, {
            key: 'temperature',
            prompt: 'Rapid-MLX text temperature (0.0 - 2.0)',
            min: 0,
            max: 2,
            success: (value) => `Rapid-MLX text temperature set to ${value}.`
        });
    } else if (paramPick.action === 'rapidTopP') {
        await updateRapidMlxTextSetting(host, {
            key: 'topP',
            prompt: 'Rapid-MLX text Top P (0.0 - 1.0)',
            min: 0,
            max: 1,
            success: (value) => `Rapid-MLX text Top P set to ${value}.`
        });
    } else if (paramPick.action === 'rapidTopK') {
        await updateRapidMlxTextSetting(host, {
            key: 'topK',
            prompt: 'Rapid-MLX text Top K (1 - 100)',
            min: 1,
            max: 100,
            integer: true,
            success: (value) => `Rapid-MLX text Top K set to ${value}.`
        });
    } else if (paramPick.action === 'rapidRepeatPenalty') {
        await updateRapidMlxTextSetting(host, {
            key: 'repeatPenalty',
            prompt: 'Rapid-MLX text repeat penalty (0.8 - 2.0)',
            min: 0.8,
            max: 2,
            success: (value) => `Rapid-MLX text repeat penalty set to ${value}.`
        });
    } else if (paramPick.action === 'rapidMaxTokens') {
        await updateRapidMlxTextSetting(host, {
            key: 'maxTokens',
            prompt: 'Rapid-MLX text max tokens (128 - 8192)',
            min: 128,
            max: 8192,
            integer: true,
            success: (value) => `Rapid-MLX text max tokens set to ${value}.`
        });
    } else if (paramPick.action === 'temp') {
        await updateNumberSetting({
            prompt: 'Temperature (0.0 - 2.0)',
            value: host.getTemperature(),
            min: 0,
            max: 2,
            setValue: (value) => host.setTemperature(value),
            success: (value) => `Temperature set to ${value}.`
        });
    } else if (paramPick.action === 'topp') {
        await updateNumberSetting({
            prompt: 'Top P (0.0 - 1.0)',
            value: host.getTopP(),
            min: 0,
            max: 1,
            setValue: (value) => host.setTopP(value),
            success: (value) => `Top P set to ${value}.`
        });
    } else if (paramPick.action === 'topk') {
        await updateNumberSetting({
            prompt: 'Top K (1 - 100)',
            value: host.getTopK(),
            min: 1,
            max: 100,
            integer: true,
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
    min?: number;
    max?: number;
    integer?: boolean;
    setValue(value: number): void;
    success(value: number): string;
}): Promise<void> {
    const val = await vscode.window.showInputBox({
        prompt: options.prompt,
        value: options.value.toString(),
        validateInput: (input) => validateNumberInput(input, options)
    });
    if (val !== undefined && val.trim() !== '') {
        const raw = Number(val);
        const parsed = options.integer ? Math.round(raw) : raw;
        options.setValue(parsed);
        vscode.window.showInformationMessage(options.success(parsed));
    }
}

async function updateRapidMlxTextSetting(host: SettingsCommandsHost, options: {
    key: keyof RapidMlxTextSamplingSettings;
    prompt: string;
    min: number;
    max: number;
    integer?: boolean;
    success(value: number): string;
}): Promise<void> {
    const current = normalizeRapidMlxTextSampling(host.getRapidMlxTextSampling());
    await updateNumberSetting({
        prompt: options.prompt,
        value: current[options.key],
        min: options.min,
        max: options.max,
        integer: options.integer,
        setValue: (value) => host.setRapidMlxTextSampling({ ...current, [options.key]: value }),
        success: options.success
    });
}

function validateNumberInput(input: string, options: { min?: number; max?: number; integer?: boolean }): string | undefined {
    const value = Number(input);
    if (input.trim() === '' || !Number.isFinite(value)) {
        return 'Enter a number.';
    }
    if (options.integer && !Number.isInteger(value)) {
        return 'Enter a whole number.';
    }
    if (options.min !== undefined && value < options.min) {
        return `Value must be at least ${options.min}.`;
    }
    if (options.max !== undefined && value > options.max) {
        return `Value must be at most ${options.max}.`;
    }
    return undefined;
}

async function showSamplingHelp(): Promise<void> {
    const pick = await vscode.window.showQuickPick([
        {
            label: '$(question) Temperature',
            detail: 'Controls randomness. Lower values make Rapid-MLX more deterministic and reduce drift/repetition risk; higher values make wording more varied but less stable.'
        },
        {
            label: '$(question) Top P',
            detail: 'Nucleus sampling. The model samples only from tokens whose cumulative probability reaches this value. Lower narrows choices; higher allows more variety.'
        },
        {
            label: '$(question) Top K',
            detail: 'Limits each step to the K most likely next tokens. Smaller values are steadier; larger values can help variety but may increase rambling.'
        },
        {
            label: '$(question) Repeat Penalty',
            detail: 'Penalizes tokens that already appeared. Values above 1 discourage repeated words/phrases; too high can make output awkward.'
        },
        {
            label: '$(question) Max Tokens',
            detail: 'Maximum number of tokens Rapid-MLX may generate for one text reply. Lower caps runaway loops sooner; higher allows longer answers.'
        }
    ], { placeHolder: 'Pick a parameter to read its explanation' });
    if (pick) {
        vscode.window.showInformationMessage(`${pick.label.replace('$(question) ', '')}: ${pick.detail}`);
    }
}

function formatRapidMlxDefaults(): string {
    const defaults = RAPID_MLX_TEXT_SAMPLING_DEFAULTS;
    return `temperature ${defaults.temperature}, top_p ${defaults.topP}, top_k ${defaults.topK}, repeatPenalty ${defaults.repeatPenalty}, max_tokens ${defaults.maxTokens}`;
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
    vscode.window.showInformationMessage('System prompt updated. Started a fresh thread.');
}
