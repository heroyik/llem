export interface ImageLightbox {
  openImageLightbox: (src: string, alt: string) => void;
  closeImageLightbox: () => void;
}

export function createImageLightbox(): ImageLightbox {
  const el = document.createElement('div');
  el.className = 'image-lightbox';
  el.hidden = true;
  el.innerHTML = [
    '<div class="image-lightbox-backdrop" data-action="close-image-lightbox"></div>',
    '<div class="image-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Image preview">',
    '<button class="image-lightbox-close" type="button" aria-label="Close image preview" data-action="close-image-lightbox">×</button>',
    '<img class="image-lightbox-img" alt="">',
    '<div class="image-lightbox-caption"></div>',
    '</div>'
  ].join('');
  document.body.appendChild(el);

  const imgEl = el.querySelector('.image-lightbox-img') as HTMLImageElement | null;
  const captionEl = el.querySelector('.image-lightbox-caption') as HTMLElement | null;
  const dialogEl = el.querySelector('.image-lightbox-dialog') as HTMLElement | null;

  function openImageLightbox(src: string, alt: string): void {
    if (!src || !imgEl || !captionEl) return;
    imgEl.src = src;
    imgEl.alt = alt || 'Attached image preview';
    captionEl.textContent = alt || 'Attached image';
    el.hidden = false;
    document.body.classList.add('image-lightbox-open');
  }

  function closeImageLightbox(): void {
    if (!imgEl || !captionEl) return;
    el.hidden = true;
    imgEl.src = '';
    imgEl.alt = '';
    captionEl.textContent = '';
    document.body.classList.remove('image-lightbox-open');
  }

  // Backdrop/close button click handler
  el.addEventListener('click', function(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-action="close-image-lightbox"]')) {
      event.preventDefault();
      closeImageLightbox();
    }
  });

  // Prevent closing when clicking the dialog itself
  dialogEl?.addEventListener('click', function(event: MouseEvent) {
    event.stopPropagation();
  });

  // Escape key handler
  window.addEventListener('keydown', function(event: KeyboardEvent) {
    if (event.key === 'Escape' && !el.hidden) {
      event.preventDefault();
      closeImageLightbox();
    }
  });

  return {
    openImageLightbox,
    closeImageLightbox
  };
}
