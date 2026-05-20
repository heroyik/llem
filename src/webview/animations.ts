export function smoothCollapseElement(el: HTMLElement, className: string = 'collapsed', removeAfter: boolean = true): void {
  el.style.overflow = 'hidden';
  el.style.maxHeight = el.scrollHeight + 'px';
  requestAnimationFrame(function() {
    void (el as HTMLElement).offsetHeight;
    el.classList.add(className);
    el.style.maxHeight = '0';
    if (removeAfter) {
      setTimeout(function() {
        if (el.parentNode) el.remove();
      }, 300);
    }
  });
}

export function smoothExpandElement(el: HTMLElement, className: string = 'collapsed', options?: { useRaf?: boolean; onExpand?: () => void; clearAfterMs?: number | false }): void {
  const useRaf = options?.useRaf !== false;
  const clearAfterMs = options?.clearAfterMs !== undefined ? options.clearAfterMs : 300;

  el.classList.remove(className);

  if (useRaf) {
    el.style.overflow = 'hidden';
    requestAnimationFrame(function() {
      el.style.maxHeight = el.scrollHeight + 'px';
      if (options?.onExpand) options.onExpand();
      if (clearAfterMs !== false) {
        setTimeout(function() {
          if (!el.classList.contains(className)) {
            el.style.maxHeight = '';
            el.style.overflow = 'auto';
          }
        }, clearAfterMs);
      }
    });
  } else {
    el.style.maxHeight = el.scrollHeight + 'px';
  }
}
