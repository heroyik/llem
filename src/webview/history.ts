export interface HistoryItem {
  id: string;
  title: string;
  lastModified?: number;
}

export interface HistoryEls {
  historyView: HTMLElement | null;
  historyList: HTMLElement | null;
  historySearch: HTMLInputElement | null;
  deleteModal: HTMLElement | null;
}

export interface HistoryDeps {
  els: HistoryEls;
  postMessage: (msg: any) => void;
  log: (message: any, level?: string) => void;
}

export function createHistory(deps: HistoryDeps) {
  const { els, postMessage, log } = deps;
  let currentDeletingId: string | null = null;
  let isBulkDelete = false;

  function renderHistory(items: HistoryItem[]): void {
    if (!els.historyList) return;
    els.historyList.innerHTML = '';
    const filtered = items.filter(function(item) {
      const q = (els.historySearch?.value || '').toLowerCase();
      return (item.title || '').toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      els.historyList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-faint);">No threads found.</div>';
      return;
    }

    filtered.forEach(function(item) {
      const el = document.createElement('div');
      el.className = 'history-item';
      const title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = item.title || 'Untitled Thread';
      const meta = document.createElement('div');
      meta.className = 'history-item-meta';
      let dateStr = 'Unknown date';
      if (item.lastModified) {
        const d = new Date(item.lastModified);
        if (!isNaN(d.getTime())) {
          const diff = Date.now() - d.getTime();
          if (diff < 60000) {
            dateStr = 'Just now';
          } else if (diff < 3600000) {
            dateStr = Math.floor(diff / 60000) + 'm ago';
          } else if (diff < 86400000) {
            dateStr = Math.floor(diff / 3600000) + 'h ago';
          } else if (diff < 604800000) {
            dateStr = Math.floor(diff / 86400000) + 'd ago';
          } else {
            dateStr = d.toLocaleDateString();
          }
        }
      }
      meta.innerHTML = '<span>' + dateStr + '</span>';

      const actions = document.createElement('div');
      actions.className = 'history-item-actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-history';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        postMessage({
          type: 'requestDeleteHistory',
          id: item.id,
          title: item.title || 'Untitled Thread'
        });
      });
      actions.appendChild(delBtn);
      meta.appendChild(actions);

      el.appendChild(title);
      el.appendChild(meta);
      el.addEventListener('click', function() {
        postMessage({ type: 'loadHistory', id: item.id });
        toggleHistory(false);
      });
      els.historyList!.appendChild(el);
    });
  }

  function toggleHistory(show: boolean): void {
    if (show) {
      if (els.historyView) els.historyView.classList.add('visible');
      postMessage({ type: 'getHistory' });
      if (els.historySearch) els.historySearch.focus();
    } else {
      if (els.historyView) els.historyView.classList.remove('visible');
    }
  }

  function showDeleteModal(id: string, title: string): void {
    isBulkDelete = false;
    currentDeletingId = id;
    const deleteThreadTitle = document.getElementById('deleteThreadTitle');
    if (deleteThreadTitle) deleteThreadTitle.textContent = title;
    if (els.deleteModal) els.deleteModal.classList.add('visible');
  }

  function hideDeleteModal(): void {
    currentDeletingId = null;
    isBulkDelete = false;
    if (els.deleteModal) els.deleteModal.classList.remove('visible');
  }

  function showClearAllModal(): void {
    isBulkDelete = true;
    currentDeletingId = null;
    const modalTitle = els.deleteModal?.querySelector('.modal-title');
    const modalBody = els.deleteModal?.querySelector('.modal-body');
    const confirmBtn = document.getElementById('confirmDeleteBtn');

    if (modalTitle) modalTitle.textContent = 'Clear All History?';
    if (modalBody) modalBody.innerHTML = 'Are you sure you want to delete <strong>all</strong> chat threads? This cannot be undone.';
    if (confirmBtn) confirmBtn.textContent = 'Clear All';
    if (els.deleteModal) els.deleteModal.classList.add('visible');
  }

  function resetDeleteModalUI(): void {
    isBulkDelete = false;
    currentDeletingId = null;
    const modalTitle = els.deleteModal?.querySelector('.modal-title');
    const modalBody = els.deleteModal?.querySelector('.modal-body');
    const confirmBtn = document.getElementById('confirmDeleteBtn');

    if (modalTitle) modalTitle.textContent = 'Delete Thread?';
    if (modalBody) modalBody.innerHTML = 'Are you sure you want to delete "<span id="deleteThreadTitle"></span>"? This cannot be undone.';
    if (confirmBtn) confirmBtn.textContent = 'Delete Thread';
  }

  return {
    renderHistory,
    toggleHistory,
    showDeleteModal,
    hideDeleteModal,
    showClearAllModal,
    resetDeleteModalUI,
    get currentDeletingId() { return currentDeletingId; },
    get isBulkDelete() { return isBulkDelete; }
  };
}
