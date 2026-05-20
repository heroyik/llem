import type { SettingsCommandsHost } from './settingsCommands';
import { normalizeRapidMlxTextSampling, type RapidMlxTextSamplingSettings } from './samplingProfiles';

export interface SettingsCommandHostDeps {
    getSystemPrompt(): string;
    setSystemPrompt(value: string): void;
    getRapidMlxTextSampling(): RapidMlxTextSamplingSettings;
    setRapidMlxTextSampling(value: RapidMlxTextSamplingSettings): void;
    resetRapidMlxTextSampling(): void;
    getTemperature(): number;
    setTemperature(value: number): void;
    getTopK(): number;
    setTopK(value: number): void;
    getTopP(): number;
    setTopP(value: number): void;
    updateGlobalState(key: string, value: any): Thenable<void>;
    resetConversationForSystemPromptChange(): Promise<void>;
    sendModels(): Promise<void>;
    listMcpServers(): Promise<void>;
    reloadMcpServers(): Promise<void>;
    syncCodexMcpServers(): Promise<void>;
    importMcpFromGitHub(): Promise<void>;
}

export function createSettingsCommandHost(deps: SettingsCommandHostDeps): SettingsCommandsHost {
    return {
        getSystemPrompt: () => deps.getSystemPrompt(),
        getRapidMlxTextSampling: () => deps.getRapidMlxTextSampling(),
        getTemperature: () => deps.getTemperature(),
        getTopK: () => deps.getTopK(),
        getTopP: () => deps.getTopP(),
        resetConversationForSystemPromptChange: () => deps.resetConversationForSystemPromptChange(),
        sendModels: () => deps.sendModels(),
        setSystemPrompt: (value) => {
            deps.setSystemPrompt(value);
            deps.updateGlobalState('aiSystemPrompt', value);
        },
        resetRapidMlxTextSampling: () => {
            deps.resetRapidMlxTextSampling();
            deps.updateGlobalState('rapidMlxTextSampling', deps.getRapidMlxTextSampling());
        },
        setRapidMlxTextSampling: (value) => {
            deps.setRapidMlxTextSampling(value);
            deps.updateGlobalState('rapidMlxTextSampling', normalizeRapidMlxTextSampling(value));
        },
        setTemperature: (value) => {
            deps.setTemperature(value);
            deps.updateGlobalState('aiTemperature', value);
        },
        setTopK: (value) => {
            deps.setTopK(value);
            deps.updateGlobalState('aiTopK', value);
        },
        setTopP: (value) => {
            deps.setTopP(value);
            deps.updateGlobalState('aiTopP', value);
        },
        listMcpServers: () => deps.listMcpServers(),
        reloadMcpServers: () => deps.reloadMcpServers(),
        syncCodexMcpServers: () => deps.syncCodexMcpServers(),
        importMcpFromGitHub: () => deps.importMcpFromGitHub()
    };
}
