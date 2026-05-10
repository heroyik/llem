import * as vscode from 'vscode';
import { getConfig } from './config';
import { contextModeCallReport, contextModeListReport } from './mcpContextModeReport';
import { getMcpManager } from './mcpManager';

const CONTEXT_MODE_SERVER = 'context-mode';
const PREFERRED_TOOLS = ['ctx_stats', 'context_stats', 'stats', 'summarize', 'compress'];

export interface ContextModeRunResult {
    report: string[];
    systemFeedback: string;
}

export async function runContextModeForPrompt(): Promise<ContextModeRunResult> {
    const config = getConfig();
    if (!config.mcpEnabled) {
        return { report: ['⚠️ context-mode skipped: MCP is disabled in LLeM settings.'], systemFeedback: '' };
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const manager = getMcpManager(workspaceRoot);
    const listed = await manager.listServerTools(CONTEXT_MODE_SERVER);
    const report = [...listed.report];
    const listReport = contextModeListReport(listed.tools);
    if (listReport) {
        report.push(listReport);
    }

    const tool = pickContextModeTool(listed.tools.map(item => item.name));
    if (!tool) {
        report.push('⚠️ context-mode skipped: no callable tool was found.');
        return { report, systemFeedback: buildSystemFeedback('', report) };
    }

    const result = await manager.callTool(CONTEXT_MODE_SERVER, tool, {});
    report.push(result.ok
        ? `✅ MCP tool called: ${CONTEXT_MODE_SERVER}.${tool}`
        : `❌ MCP tool failed: ${CONTEXT_MODE_SERVER}.${tool} — ${result.text}`);
    const callReport = contextModeCallReport(result);
    if (callReport) {
        report.push(callReport);
    }

    return {
        report,
        systemFeedback: buildSystemFeedback(result.ok ? result.text : '', report)
    };
}

function pickContextModeTool(toolNames: string[]): string | undefined {
    for (const preferred of PREFERRED_TOOLS) {
        const match = toolNames.find(name => name === preferred);
        if (match) {
            return match;
        }
    }
    return toolNames[0];
}

function buildSystemFeedback(toolResult: string, report: string[]): string {
    const resultSection = toolResult
        ? `\n\n[context-mode tool result]\n${toolResult}`
        : '';
    return `[SYSTEM: context-mode ran before this model request]\n${report.join('\n')}${resultSection}`;
}
