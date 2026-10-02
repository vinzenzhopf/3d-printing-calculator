/**
 * Registers the offline service worker (production builds only) and offers a
 * reload when a new version has been downloaded. Updates never interrupt work:
 * the new version activates only after the user clicks "Reload".
 */
export function registerServiceWorker(): void {
  let userAccepted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userAccepted) location.reload();
  });

  void navigator.serviceWorker.register('./sw.js').then((reg) => {
    // The banner targets whatever is waiting at click time: a newer deploy may
    // have replaced the worker the banner was first shown for.
    const offer = (worker: ServiceWorker) =>
      showUpdateBanner(() => {
        userAccepted = true;
        (reg.waiting ?? worker).postMessage('SKIP_WAITING');
      });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    window.addEventListener('focus', () => void reg.update().catch(() => undefined));
  });
}

function showUpdateBanner(apply: () => void): void {
  if (document.getElementById('update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'position-fixed bottom-0 start-50 translate-middle-x mb-3 alert alert-primary shadow d-flex gap-3 align-items-center d-print-none';
  banner.style.zIndex = '1080';
  banner.innerHTML = '<span>A new version is available.</span><button class="btn btn-sm btn-primary">Reload</button>';
  banner.querySelector('button')!.addEventListener('click', apply);
  document.body.append(banner);
}
