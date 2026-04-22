import * as vscode from 'vscode';
import { showBrainNetwork } from './brainNetwork';
import type { SidebarChatProvider } from './sidebarChatProvider';

export function registerExtensionCommands(context: vscode.ExtensionContext, provider: SidebarChatProvider): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.openChat', () => {
            provider.openChatPanel();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.newChat', () => {
            provider.resetChat();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.exportChat', async () => {
            await provider.exportChat();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.focusChat', () => {
            provider.focusInput();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.explainSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const selection = editor.document.getText(editor.selection);
            if (selection.trim()) {
                provider.sendPromptFromExtension(`이 코드를 분석하고 설명해줘:\n\`\`\`\n${selection}\n\`\`\``);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.showBrainNetwork', () => {
            showBrainNetwork(context);
        })
    );
}
