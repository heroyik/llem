import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function runGit(cwd: string, args: string[]) {
    return execFileAsync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
    });
}

export function isNothingToCommitError(error: any): boolean {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    return output.includes('nothing to commit') || output.includes('no changes added to commit');
}
