export interface EnterSubmissionEventLike {
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export function shouldSubmitOnEnter(event: EnterSubmissionEventLike): boolean {
  if (event.key !== 'Enter' || event.shiftKey) {
    return false;
  }

  // Some IMEs report composition state via isComposing, while others only
  // expose keyCode 229 during composition confirmation.
  if (event.isComposing || event.keyCode === 229) {
    return false;
  }

  return true;
}
