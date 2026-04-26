import * as vscode from 'vscode';

export interface PerfMetrics {
    contextBuildMs: number;
    vaultScanMs: number;
    vaultFileCount: number;
    promptSizeEstimateChars: number;
    streamFirstTokenMs: number;
    streamTotalTokens: number;
    streamTokensPerSecond: number;
}

const metrics: PerfMetrics = {
    contextBuildMs: 0,
    vaultScanMs: 0,
    vaultFileCount: 0,
    promptSizeEstimateChars: 0,
    streamFirstTokenMs: 0,
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
        channel.appendLine(`Context Build Duration : ${metrics.contextBuildMs.toFixed(1)} ms`);
        channel.appendLine(`Vault Scan             : ${metrics.vaultFileCount} files in ${metrics.vaultScanMs.toFixed(1)} ms`);
        channel.appendLine(`Prompt Size Estimate   : ${metrics.promptSizeEstimateChars} chars`);
        channel.appendLine(`Stream First Token     : ${metrics.streamFirstTokenMs.toFixed(1)} ms`);
        channel.appendLine(`Stream Speed           : ${metrics.streamTokensPerSecond.toFixed(1)} tokens/sec (${metrics.streamTotalTokens} tokens)`);
        channel.appendLine('========================');
        channel.show(true);
    }
};
