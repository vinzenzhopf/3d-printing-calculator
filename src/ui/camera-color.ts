import { medianColor } from '../core/colors';

/**
 * Picks a color with the camera: a live preview of the color inside the ring
 * in the middle of the picture. Phone cameras adjust white balance, so this is
 * a good start, not an exact match. Nothing leaves the device.
 * Resolves with "#RRGGBB", or null when cancelled.
 */
export function pickColorFromCamera(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'position-fixed top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center';
    overlay.style.cssText = 'z-index: 2100; background: #000;';
    overlay.innerHTML = `
      <video playsinline muted style="width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0;"></video>
      <div style="position: relative; width: 12vmin; aspect-ratio: 1; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 0 2px #000;"></div>
      <div class="position-absolute bottom-0 w-100 p-3 d-flex flex-column gap-2 align-items-center" style="z-index: 1;">
        <div class="d-flex align-items-center gap-2 bg-body text-body rounded-pill px-3 py-1">
          <span data-chip class="rounded-circle border" style="width: 2rem; height: 2rem;"></span><span data-hex class="font-monospace">…</span>
        </div>
        <div class="text-white small text-center" data-msg>Put the filament in the ring, in daylight if you can.</div>
        <div class="d-flex gap-2"><button type="button" class="btn btn-light" data-cancel>Cancel</button><button type="button" class="btn btn-primary" data-use disabled>Use this color</button></div>
      </div>`;
    document.body.append(overlay);
    const video = overlay.querySelector('video')!;
    const msg = overlay.querySelector<HTMLElement>('[data-msg]')!;
    const chip = overlay.querySelector<HTMLElement>('[data-chip]')!;
    const hexText = overlay.querySelector<HTMLElement>('[data-hex]')!;
    const use = overlay.querySelector<HTMLButtonElement>('[data-use]')!;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let current: string | null = null;
    let done = false;

    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('[data-cancel]')!.addEventListener('click', () => finish(null));
    use.addEventListener('click', () => finish(current));

    const sample = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      // The ring is 12 % of the screen's shorter side; sample the inner half of it.
      const side = Math.max(4, Math.round(Math.min(w, h) * 0.06));
      canvas.width = canvas.height = side;
      ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
      current = medianColor(ctx.getImageData(0, 0, side, side).data);
      chip.style.background = current;
      hexText.textContent = current;
      use.disabled = false;
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        msg.textContent = name === 'NotAllowedError' ? 'Camera access was denied. Allow it in the browser settings for this site.' : 'The camera could not be started.';
        return;
      }
      if (done) return finish(null);
      video.srcObject = stream;
      await video.play();
      timer = setInterval(sample, 250);
    })();
  });
}
