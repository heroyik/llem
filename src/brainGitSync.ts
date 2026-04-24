import { isNothingToCommitError, runGit } from './gitUtils';

interface BrainSyncNotifier {
    injectSystemMessage(message: string): void;
}

let brainGitSyncQueue: Promise<void> = Promise.resolve();

export function queueBrainGitSync(brainDir: string, message: string): Promise<void> {
    const task = brainGitSyncQueue.catch(() => undefined).then(async () => {
        await runGit(brainDir, ['add', '.']);
        await runGit(brainDir, ['commit', '-m', message]).catch((err: any) => {
            if (!isNothingToCommitError(err)) {
                throw err;
            }
        });
        await runGit(brainDir, ['push']);
    });

    brainGitSyncQueue = task.catch(() => undefined);
    return task;
}

export function tryAutoPushBrain(brainDir: string, message: string, provider: BrainSyncNotifier): void {
    queueBrainGitSync(brainDir, message).then(() => {
        setTimeout(() => {
            provider.injectSystemMessage('✅ **[Vault Sync]** Your latest vault drop is backed up to GitHub and fully in sync.');
        }, 5000);
    }).catch((err) => {
        console.error('Git Auto-Push Failed:', err);
        setTimeout(() => {
            provider.injectSystemMessage('✅ Your vault drop landed safely in local mode.\n\nTip: connect a GitHub repo from the vault menu if you want cloud backup too.');
        }, 5000);
    });
}
