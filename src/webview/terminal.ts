export interface TerminalActions {
  openTerminal: () => void;
}

export function createTerminal(postMessage: (msg: any) => void): TerminalActions {
  function openTerminal(): void {
    postMessage({ type: 'showTerminal' });
  }

  return {
    openTerminal
  };
}
