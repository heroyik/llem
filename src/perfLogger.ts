import * as vscode from 'vscode';

export interface PerfMetrics {
    modelName: string;
    performancePreset: string;
    contextBuildMs: number;
    vaultScanMs: number;
    vaultFileCount: number;
    promptSizeEstimateChars: number;
    finalRequestChars: number;
    historyChars: number;
    activeEditorChars: number;
    workspaceChars: number;
    vaultChars: number;
    attachmentChars: number;
    prunedMessages: number;
    prunedAttachmentChars: number;
    streamFirstTokenMs: number;
    streamTotalMs: number;
    streamTotalTokens: number;
    streamTokensPerSecond: number;
}

const metrics: PerfMetrics = {
    modelName: '',
    performancePreset: '',
    contextBuildMs: 0,
    vaultScanMs: 0,
    vaultFileCount: 0,
    promptSizeEstimateChars: 0,
    finalRequestChars: 0,
    historyChars: 0,
    activeEditorChars: 0,
    workspaceChars: 0,
    vaultChars: 0,
    attachmentChars: 0,
    prunedMessages: 0,
    prunedAttachmentChars: 0,
    streamFirstTokenMs: 0,
    streamTotalMs: 0,
    streamTotalTokens: 0,
    streamTokensPerSecond: 0
};

let perfChannel: vscode.OutputChannel | undefined;

export function getPerfChannel(): vscode.OutputChannel {
    if (!perfChannel) {
        perfChannel = vscode.window.createOutputChannel('LLeM Performance');
    }
    return perfChannel;
}

export const PerfLogger = {
    update(updates: Partial<PerfMetrics>): void {
        Object.assign(metrics, updates);
    },

    log(message: string): void {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        getPerfChannel().appendLine(`[${time}] ${message}`);
    },

    showDiagnostics(): void {
        const channel = getPerfChannel();
        channel.clear();
        channel.appendLine('=== LLeM Diagnostics ===');
        channel.appendLine(`Model / Profile         : ${metrics.modelName || '(unknown)'} / ${metrics.performancePreset || '(unknown)'}`);
        channel.appendLine(`Context Build Duration : ${metrics.contextBuildMs.toFixed(1)} ms`);
        channel.appendLine(`Vault Scan             : ${metrics.vaultFileCount} files in ${metrics.vaultScanMs.toFixed(1)} ms`);
        channel.appendLine(`Prompt Size Estimate   : ${metrics.promptSizeEstimateChars} chars`);
        channel.appendLine(`Final Request Chars    : ${metrics.finalRequestChars} chars`);
        channel.appendLine(`History / Attachments  : ${metrics.historyChars} / ${metrics.attachmentChars} chars`);
        channel.appendLine(`Active / Workspace     : ${metrics.activeEditorChars} / ${metrics.workspaceChars} chars`);
        channel.appendLine(`Vault / Pruned         : ${metrics.vaultChars} chars / ${metrics.prunedMessages} msg`);
        channel.appendLine(`Pruned Attachments     : ${metrics.prunedAttachmentChars} chars`);
        channel.appendLine(`Stream First Token     : ${metrics.streamFirstTokenMs.toFixed(1)} ms`);
        channel.appendLine(`Stream Total Duration  : ${metrics.streamTotalMs.toFixed(1)} ms`);
        channel.appendLine(`Stream Speed           : ${metrics.streamTokensPerSecond.toFixed(1)} tokens/sec (${metrics.streamTotalTokens} tokens)`);
        channel.appendLine('========================');
        channel.show(true);
    }
};
