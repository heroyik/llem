import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export async function writeUtf8FileAtomic(filePath: string, content: string, mode?: number): Promise<void> {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`);

    try {
        await fs.promises.writeFile(tmpPath, content, { encoding: 'utf-8', flag: 'wx', mode });
        if (mode !== undefined) {
            await fs.promises.chmod(tmpPath, mode);
        }
        await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
        await fs.promises.rm(tmpPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
