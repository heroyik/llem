export function copyCode(btn: HTMLElement) {
  const code = btn.parentElement?.querySelector('code');
  if (!code) return;
  navigator.clipboard.writeText(code.innerText).then(function() {
    btn.textContent = 'Copied';
    btn.classList.add('copied');
    setTimeout(function() {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 1400);
  });
}

export function copyMessageText(messageEl: HTMLElement | null) {
  if (!(messageEl instanceof Element)) return;
  const body = messageEl.querySelector('.msg-body');
  if (!(body instanceof HTMLElement)) return;
  navigator.clipboard.writeText(body.innerText.trim()).then(function() {
    const feedback = messageEl.querySelector('.msg-action-feedback');
    if (!feedback) return;
    const previous = feedback.textContent;
    feedback.textContent = 'Copied';
    setTimeout(function() {
      feedback.textContent = previous || '';
    }, 1400);
  });
}
