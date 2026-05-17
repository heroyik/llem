export type ExecutionMode = 'default' | 'plan' | 'agent';

export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'default';

export function normalizeExecutionMode(value: unknown): ExecutionMode {
    if (value === 'plan' || value === 'agent' || value === 'default') {
        return value;
    }
    return DEFAULT_EXECUTION_MODE;
}

export function executionModeLabel(mode: ExecutionMode): string {
    switch (mode) {
        case 'plan':
            return 'Plan Mode';
        case 'agent':
            return 'Agent Mode';
        default:
            return 'Default Mode';
    }
}

export function buildExecutionModeDirective(mode: ExecutionMode): string {
    if (mode === 'plan') {
        return `\n\n[EXECUTION MODE: PLAN]\nYou are in Plan Mode. First inspect context as needed, then produce a concise implementation plan. Do not create, edit, delete files, run terminal commands, or call MCP tools that change external state. Use read-only actions only when they are needed to make the plan accurate. End by asking the user to approve the plan before implementation.`;
    }

    if (mode === 'agent') {
        return `\n\n[EXECUTION MODE: AGENT]\nYou are in Agent Mode. Work autonomously toward the user's goal: inspect the repo, make focused edits, run useful verification commands, and continue from action results until the task is genuinely handled. Keep user-facing progress concise and stop for approval only when a risky or destructive action is required.`;
    }

    return `\n\n[EXECUTION MODE: DEFAULT]\nUse the normal LLeM workflow. When the user asks for changes, make them with the available actions; when they ask for analysis or planning, answer directly.`;
}

export interface ActionModeSummary {
    create: number;
    edit: number;
    delete: number;
    command: number;
    callMcpTool: number;
    mcpSlashCommand?: number;
    fallbackFileBlocks: number;
}

export function summarizeBlockedPlanActions(summary: ActionModeSummary): string[] {
    const blocked: string[] = [];
    if (summary.create > 0) {
        blocked.push(`${summary.create} create action(s)`);
    }
    if (summary.edit > 0) {
        blocked.push(`${summary.edit} edit action(s)`);
    }
    if (summary.delete > 0) {
        blocked.push(`${summary.delete} delete action(s)`);
    }
    if (summary.command > 0) {
        blocked.push(`${summary.command} terminal command(s)`);
    }
    if (summary.callMcpTool > 0) {
        blocked.push(`${summary.callMcpTool} MCP tool call(s)`);
    }
    if ((summary.mcpSlashCommand || 0) > 0) {
        blocked.push(`${summary.mcpSlashCommand} MCP slash command(s)`);
    }
    if (summary.fallbackFileBlocks > 0) {
        blocked.push(`${summary.fallbackFileBlocks} inferred file block(s)`);
    }
    return blocked;
}
