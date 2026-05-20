// ---------------------------------------------------------------------------
// Global error/rejection overlay handlers — extracted from main.ts
// ---------------------------------------------------------------------------

export function setupErrorOverlays(): void {
  window.onerror = function(msg: string | Event, url?: string, line?: number) {
    const overlay = document.createElement('div');
    overlay.className = 'fatal-overlay fatal-overlay-top';
    overlay.textContent = 'ERROR: ' + String(msg) + (line ? ' at line ' + line : '');
    document.body.appendChild(overlay);
  };

  window.addEventListener('unhandledrejection', function(event: PromiseRejectionEvent) {
    const overlay = document.createElement('div');
    overlay.className = 'fatal-overlay fatal-overlay-bottom';
    overlay.textContent = 'PROMISE REJECTION: ' + event.reason;
    document.body.appendChild(overlay);
  });
}
