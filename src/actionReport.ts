import * as vscode from 'vscode';
import { getVaultDir } from './config';
import { tryAutoPushBrain } from './brainGitSync';
import type { ActionExecutionHost } from './actionExecutor';

export interface ActionReportContext {
    report: string[];
    workspaceModified: boolean;
    brainModified: boolean;
    host: ActionExecutionHost;
}

export function finalizeActionReport(context: ActionReportContext): void {
    const successCount = context.report.filter(r => 
        r.startsWith('✅') || r.startsWith('✏️') || r.startsWith('🖥️') || 
        r.startsWith('🗑️') || r.startsWith('📖') || r.startsWith('📂')
    ).length;

    if (successCount > 0) {
        vscode.window.showInformationMessage(`LLeM wrapped ${successCount} action${successCount === 1 ? '' : 's'}.`);
    }

    if (context.brainModified) {
        tryAutoPushBrain(getVaultDir(), 'Auto-sync vault updates', context.host);
        context.report.push('☁️ **[Vault Sync]** GitHub backup kicked off in the background.');
    }

    if (context.workspaceModified || context.brainModified) {
        context.host.invalidateContextCaches({ workspace: context.workspaceModified, brain: context.brainModified });
    }
}
