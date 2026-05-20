export function splitFileReference(rawValue: string): { path: string; line?: number } {
  const value = String(rawValue || '').trim();
  const match = value.match(/^(.*):(\d+)$/);
  if (!match) {
    return { path: value };
  }

  const line = Number(match[2]);
  if (!Number.isFinite(line) || line <= 0) {
    return { path: value };
  }
  return { path: match[1], line };
}

export function scoreFileSuggestion(filePath: string, query: string): number {
  const lower = filePath.toLowerCase();
  const q = query.toLowerCase();
  const base = lower.split('/').pop() || lower;
  if (!q) return filePath.length;
  if (base.startsWith(q)) return 0;
  if (lower.startsWith(q)) return 1;
  const baseIndex = base.indexOf(q);
  if (baseIndex >= 0) return 10 + baseIndex;
  const pathIndex = lower.indexOf(q);
  if (pathIndex >= 0) return 50 + pathIndex;
  return 9999;
}
