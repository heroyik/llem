export interface CommandPolicyResult {
    allowed: boolean;
    reason?: string;
}

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    {
        pattern: /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+(?:\/|~|\$HOME|%USERPROFILE%)(?:\s|$)/i,
        reason: 'refuses recursive force deletion of a home or root directory'
    },
    {
        pattern: /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+\.\.(?:[\\/]|$)/i,
        reason: 'refuses recursive force deletion outside the workspace'
    },
    {
        pattern: /\bgit\s+reset\s+--hard\b/i,
        reason: 'refuses destructive git reset'
    },
    {
        pattern: /\bgit\s+clean\b[\s\S]*\s-[^\s]*f/i,
        reason: 'refuses destructive git clean'
    },
    {
        pattern: /\bRemove-Item\b(?=[\s\S]*\s-Recurse\b)(?=[\s\S]*\s-Force\b)[\s\S]*(?:\$HOME|~|[A-Za-z]:\\|\/)(?:\s|$)/i,
        reason: 'refuses recursive forced removal of broad filesystem paths'
    },
    {
        pattern: /\bdel\s+\/[sq]\b|\brmdir\s+\/s\b/i,
        reason: 'refuses recursive Windows deletion commands'
    },
    {
        pattern: /\bformat\s+[A-Za-z]:/i,
        reason: 'refuses disk format commands'
    },
    {
        pattern: /\bshutdown\s+(?:\/s|\/r|-h|-r|now)\b/i,
        reason: 'refuses shutdown or reboot commands'
    },
    {
        pattern: /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[\s\S]*(?:\||;|&&)\s*(?:sh|bash|zsh|pwsh|powershell|iex|Invoke-Expression)\b/i,
        reason: 'refuses piping downloaded content directly into an interpreter'
    },
    {
        pattern: /(?:^|\s)(?:>{1,2}|Out-File\s+(?:-FilePath\s+)?)\s*(?:\/etc\/|\/bin\/|\/sbin\/|\/usr\/bin\/|~[\\/]|(?:\$HOME|%USERPROFILE%)[\\/]|[A-Za-z]:\\(?:Windows|Users)(?:\\|$))/i,
        reason: 'refuses redirecting command output into sensitive filesystem paths'
    }
];

export function validateTerminalCommand(command: string): CommandPolicyResult {
    const normalized = normalizeCommand(command);
    if (!normalized) {
        return { allowed: false, reason: 'empty command' };
    }

    for (const blocked of BLOCKED_PATTERNS) {
        if (blocked.pattern.test(normalized)) {
            return { allowed: false, reason: blocked.reason };
        }
    }

    return { allowed: true };
}

function normalizeCommand(command: string): string {
    return String(command || '')
        .replace(/`[\r\n]+/g, '')
        .replace(/\\[\r\n]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
