export class FileMutationGuard {
    private activePaths = new Set<string>();

    public tryAcquire(filePath: string): boolean {
        const normalized = this.normalize(filePath);
        if (this.activePaths.has(normalized)) {
            return false;
        }
        this.activePaths.add(normalized);
        return true;
    }

    public release(filePath: string): void {
        this.activePaths.delete(this.normalize(filePath));
    }

    private normalize(filePath: string): string {
        return String(filePath || '').trim().toLowerCase();
    }
}
