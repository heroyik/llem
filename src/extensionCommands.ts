import * as vscode from 'vscode';
import { showBrainNetwork } from './brainNetwork';
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
