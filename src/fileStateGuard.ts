import * as crypto from 'crypto';
import * as fs from 'fs';
import { logInfo } from './logger';

interface SnapshotEntry {
    hash: string;
    noEffectCount: number;
    ts: number;
}

export type FileEditEffect = 'effective' | 'no-effect' | 'loop-detected';

/**
 * FileStateGuard — edit_file 실행 전후 파일 SHA-256 해시를 비교해
 * <find> 매칭 실패를 즉시 감지한다.
 *
 * - 'effective'     : 파일 내용이 실제로 바뀜 (정상 편집)
 * - 'no-effect'     : 파일 내용이 동일 (find 실패 등)
 * - 'loop-detected' : maxNoEffect 회 연속 무효 편집 → 루프로 간주
 *
 * 정당하게 같은 파일을 여러 번 편집하는 경우도 있으므로
 * 한 번이라도 effective가 나오면 noEffectCount를 리셋한다.
 */
export class FileStateGuard {
    private snapshots = new Map<string, SnapshotEntry>();
    private readonly ttlMs: number;
    private readonly maxNoEffect: number;

    constructor(ttlMs = 5 * 60 * 1000, maxNoEffect = 2) {
        this.ttlMs = ttlMs;
        this.maxNoEffect = maxNoEffect;
    }

    /** 수정 실행 전 현재 파일 hash를 기록한다. */
    snapshot(filePath: string): void {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            const existing = this.snapshots.get(filePath);
            this.snapshots.set(filePath, {
                hash,
                noEffectCount: existing?.noEffectCount ?? 0,
                ts: Date.now()
            });
        } catch {
            // 파일이 없으면 (create_file 대상 등) 무시
        }
    }

    /**
     * 수정 실행 후 호출. 이전 snapshot과 현재 파일을 비교한다.
     * snapshot()이 호출된 적 없는 경로는 'effective'로 간주한다.
     */
    checkResult(filePath: string): FileEditEffect {
        const prev = this.snapshots.get(filePath);
        if (!prev) {
            return 'effective';
        }

        // TTL 만료 시 스냅샷 무효화
        if (Date.now() - prev.ts > this.ttlMs) {
            this.snapshots.delete(filePath);
            return 'effective';
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const currentHash = crypto.createHash('sha256').update(content).digest('hex');

            if (currentHash !== prev.hash) {
                // 파일이 실제로 변경됨 — 카운터 리셋
                this.snapshots.set(filePath, { hash: currentHash, noEffectCount: 0, ts: Date.now() });
                return 'effective';
            }

            // 파일이 동일 — 무효 편집 카운터 증가
            const noEffectCount = prev.noEffectCount + 1;
            this.snapshots.set(filePath, { ...prev, noEffectCount });

            logInfo(`[FileStateGuard] No-effect edit on ${filePath} (count=${noEffectCount}/${this.maxNoEffect})`);

            if (noEffectCount >= this.maxNoEffect) {
                return 'loop-detected';
            }
            return 'no-effect';
        } catch {
            return 'effective';
        }
    }

    /** 지정 경로의 상태를 초기화 (파일 삭제·재생성 후 호출). */
    clearPath(filePath: string): void {
        this.snapshots.delete(filePath);
    }

    /** 모든 상태 초기화 (새 채팅 세션 시작 시). */
    reset(): void {
        this.snapshots.clear();
    }
}
