import * as vscode from 'vscode';
import { getLlemSettings } from './config';
import { findImportableMcpSources } from './mcpImportDiscovery';

const DISMISSED_SOURCES_KEY = 'mcpImportPrompt.dismissedSources';

export async function promptForExternalMcpImports(context: vscode.ExtensionContext): Promise<void> {
    const settings = getLlemSettings();
    const configured = new Set(settings.get<string[]>('mcpConfigSources', ['workspace']));
    const dismissed = new Set(context.globalState.get<string[]>(DISMISSED_SOURCES_KEY, []));
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const importable = findImportableMcpSources({
        configuredSources: [...configured],
        dismissedSources: [...dismissed],
        workspaceRoot
    });

    if (importable.length === 0) {
        return;
    }

    const names = importable.map(source => source.label).join(', ');
    const action = await vscode.window.showInformationMessage(
        `LLeM found MCP configs from ${names}. Import them now?`,
        'Import',
        'Not now',
        'Never ask'
    );

    if (action === 'Import') {
        const nextSources = [...configured, ...importable.map(source => source.id)];
        await settings.update('mcpConfigSources', dedupe(nextSources), vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`LLeM MCP imports enabled for ${names}.`);
        return;
    }

    if (action === 'Never ask') {
        await context.globalState.update(DISMISSED_SOURCES_KEY, dedupe([...dismissed, ...importable.map(source => source.id)]));
    }
}

function dedupe(values: string[]): string[] {
    return [...new Set(values)];
}
