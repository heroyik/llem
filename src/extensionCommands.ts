import * as vscode from 'vscode';
import { showBrainNetwork } from './brainNetwork';
import { executionModeLabel, type ExecutionMode } from './executionMode';
import type { SidebarChatProvider } from './sidebarChatProvider';

export function registerExtensionCommands(context: vscode.ExtensionContext, provider: SidebarChatProvider): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('llem.openChat', async () => {
            await provider.openChatPanel();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('llem.newChat', () => {
            provider.resetChat();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('llem.exportChat', async () => {
            await provider.exportChat();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('llem.focusChat', async () => {
            await provider.focusInput();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('llem.explainSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const selection = editor.document.getText(editor.selection);
            if (selection.trim()) {
                void provider.sendPromptFromExtension(`Break this down for me:\n\`\`\`\n${selection}\n\`\`\``);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('llem.showVaultMap', () => {
            showBrainNetwork(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('llem.showDiagnostics', () => {
            import('./perfLogger').then(m => m.PerfLogger.showDiagnostics());
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('llem.setExecutionMode', async () => {
            const picks: Array<vscode.QuickPickItem & { mode: ExecutionMode }> = [
                { label: 'Default Mode', description: 'Normal chat and action execution.', mode: 'default' },
                { label: 'Plan Mode', description: 'Draft a plan first and block write/command actions.', mode: 'plan' },
                { label: 'Agent Mode', description: 'Autonomously inspect, edit, and verify.', mode: 'agent' }
            ];
            const current = provider.getExecutionMode();
            const pick = await vscode.window.showQuickPick(picks, {
                title: `LLeM Mode: ${executionModeLabel(current)}`,
                placeHolder: 'Choose how LLeM should handle the next request'
            });
            if (pick) {
                await provider.setExecutionMode(pick.mode);
            }
        }),
        vscode.commands.registerCommand('llem.setDefaultMode', async () => {
            await provider.setExecutionMode('default');
        }),
        vscode.commands.registerCommand('llem.setPlanMode', async () => {
            await provider.setExecutionMode('plan');
        }),
        vscode.commands.registerCommand('llem.setAgentMode', async () => {
            await provider.setExecutionMode('agent');
        }),
        vscode.commands.registerCommand('llem.approvePlan', async () => {
            await provider.setExecutionMode('agent');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('llem.reloadMcpServers', async () => {
            await provider.reloadMcpServers();
        }),
        vscode.commands.registerCommand('llem.listMcpServers', async () => {
            await provider.listMcpServers();
        }),
        vscode.commands.registerCommand('llem.syncCodexMcpServers', async () => {
            await provider.syncCodexMcpServers();
        }),
        vscode.commands.registerCommand('llem.importMcpFromGitHub', async () => {
            await provider.importMcpFromGitHub();
        })
    );
}
