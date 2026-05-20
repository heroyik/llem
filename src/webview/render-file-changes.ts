// ---------------------------------------------------------------------------
// File changes summary rendering — extracted from main.ts
// ---------------------------------------------------------------------------

import { isEditableFilePath } from '../editableFiles';
import { esc } from './strings';
import { fileNameFromPath } from './format';

export function renderFileChangesSummary(
  payloadText: string,
  log: (message: any, level?: string) => void
): string {
  try {
    const payload = JSON.parse(payloadText);
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files.length === 0) return '';

    const totalFiles = Number(payload.totalFiles || files.length);
    const totalAdditions = Number(payload.additions || 0);
    const totalDeletions = Number(payload.deletions || 0);
    const rows = files.map(function(file: any) {
      const filePath = String(file.path || '');
      const kind = String(file.kind || 'edited');
      const action = kind === 'created' ? 'Created' : kind === 'deleted' ? 'Deleted' : 'Editing';
      const additions = Number(file.additions || 0);
      const deletions = Number(file.deletions || 0);
      const attrs = isEditableFilePath(filePath)
        ? ' data-action="open-file" data-file-path="' + esc(filePath) + '" role="button" tabindex="0" title="Open ' + esc(filePath) + '"'
        : '';
      return '<div class="change-row"' + attrs + '>' +
        '<span class="change-icon">✎</span>' +
        '<span class="change-action">' + esc(action) + '</span>' +
        '<span class="change-file" title="' + esc(filePath) + '">' + esc(fileNameFromPath(filePath)) + '</span>' +
        '<span class="change-add">+' + additions + '</span>' +
        '<span class="change-del">-' + deletions + '</span>' +
      '</div>';
    }).join('');

    return '<div class="changes-card">' +
      '<div class="changes-list">' + rows + '</div>' +
      '<div class="changes-footer">' +
        '<span>' + totalFiles + ' file' + (totalFiles === 1 ? '' : 's') + ' changed</span>' +
        '<span class="change-add">+' + totalAdditions + '</span>' +
        '<span class="change-del">-' + totalDeletions + '</span>' +
        '<button class="review-changes-btn" data-action="review-changes">Review changes</button>' +
      '</div>' +
    '</div>';
  } catch (error) {
    log('[UI] Failed to render file changes summary: ' + (error instanceof Error ? error.message : String(error)), 'error');
    return '';
  }
}
