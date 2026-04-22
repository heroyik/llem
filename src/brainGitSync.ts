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
            provider.injectSystemMessage('✅ **[P-Reinforce Sync]** 주입된 지식을 글로벌 두뇌(GitHub)에 안전하게 백업 및 동기화 완료했습니다.');
        }, 5000);
    }).catch((err) => {
        console.error('Git Auto-Push Failed:', err);
        setTimeout(() => {
            provider.injectSystemMessage('✅ 지식이 로컬 오프라인 모드로 안전하게 주입되었습니다.\n\n💡 **Tip:** 만약 온라인 두뇌(클라우드) 동기화를 원하시면, 좌측 사이드바 뇌(🧠) 아이콘을 눌러 깃허브 저장소를 연결해보세요!');
        }, 5000);
    });
}
