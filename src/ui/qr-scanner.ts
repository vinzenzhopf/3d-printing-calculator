import { spoolKeyFromScan } from '../core/stock';
import { tell } from './dialogs';

/**
 * Camera QR scanner as a full-screen overlay. Uses the browser's built-in
 * BarcodeDetector where available (Chrome on Android), otherwise the small
 * jsQR decoder, loaded only when needed (Firefox, iOS). Needs HTTPS and camera
 * permission; nothing leaves the device.
 */

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

export interface ScanOptions {
  /** 'any': also barcodes and Data Matrix codes, where the browser can read them (QR codes everywhere). */
  formats?: 'qr' | 'any';
  prompt?: string;
}

/** Resolves with the scanned text, or null when cancelled. */
export function scanQr(opts: ScanOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'position-fixed top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center';
    overlay.style.cssText = 'z-index: 2000; background: #000;';
    overlay.innerHTML = `
      <video playsinline muted style="width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0;"></video>
      <div style="position: relative; width: min(70vw, 70vh); aspect-ratio: 1; border: 3px solid rgba(255,255,255,.85); border-radius: 12px; box-shadow: 0 0 0 100vmax rgba(0,0,0,.45);"></div>
      <div class="position-absolute bottom-0 w-100 p-3 d-flex flex-column gap-2 align-items-center" style="z-index: 1;">
        <div class="text-white small text-center" data-msg></div>
        <button type="button" class="btn btn-light">Cancel</button>
      </div>`;
    document.body.append(overlay);
    const video = overlay.querySelector('video')!;
    const msg = overlay.querySelector<HTMLElement>('[data-msg]')!;
    msg.textContent = opts.prompt ?? 'Point the camera at a spool label.';
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('button')!.addEventListener('click', () => finish(null));

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        msg.textContent =
          name === 'NotAllowedError' ? 'Camera access was denied. Allow it in the browser settings for this site.'
          : name === 'NotFoundError' ? 'No camera found.'
          : 'The camera could not be started.';
        return;
      }
      if (done) return finish(null);
      video.srcObject = stream;
      await video.play();

      const decode = await makeDecoder(video, opts.formats ?? 'qr');
      const tick = async () => {
        if (done) return;
        try {
          const text = await decode();
          if (text) {
            navigator.vibrate?.(60);
            return finish(text);
          }
        } catch {
          // frame not ready yet
        }
        timer = setTimeout(() => void tick(), 150);
      };
      void tick();
    })();
  });
}

async function makeDecoder(video: HTMLVideoElement, formats: 'qr' | 'any'): Promise<() => Promise<string | null>> {
  const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  const supported = Ctor ? await Ctor.getSupportedFormats().catch((): string[] => []) : [];
  if (Ctor && supported.includes('qr_code')) {
    const detector = new Ctor({ formats: formats === 'any' ? supported : ['qr_code'] });
    return async () => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  const jsQR = (await import('jsqr')).default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async () => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    // Decode a downscaled center crop: faster, and the label is in the frame guide anyway.
    const side = Math.min(w, h);
    const size = Math.min(side, 640);
    canvas.width = canvas.height = size;
    ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    return jsQR(ctx.getImageData(0, 0, size, size).data, size, size, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/** Scans and opens the scanned spool label; other codes go to `onOther` (e.g. into a search field). */
export async function scanAndOpen(onOther?: (text: string) => void): Promise<void> {
  const text = await scanQr();
  if (!text) return;
  const key = spoolKeyFromScan(text);
  if (key) location.hash = `#/spool/${encodeURIComponent(key)}`;
  else if (onOther) onOther(text);
  else await tell(`Not a spool label: ${text}`);
}
