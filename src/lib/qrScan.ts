/**
 * Reading a QR code without a QR library.
 *
 * `BarcodeDetector` is built into the browser and costs nothing to use. No
 * decoding library can be installed here, and even where one could, shipping a
 * few hundred kilobytes of decoder so that some people can point a camera at a
 * card is a poor trade — this is free where it exists and absent where it does
 * not, which is a thing the UI can say plainly.
 *
 * Two ways in, and the second matters as much as the first: a camera for a
 * code on somebody else's screen, and an image file for the gift card someone
 * sent through a chat app. That picture is the common case, and it never
 * passes in front of a lens.
 */

interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource | Blob): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

function detectorClass(): BarcodeDetectorConstructor | null {
  const global = globalThis as { BarcodeDetector?: BarcodeDetectorConstructor };
  return global.BarcodeDetector ?? null;
}

/** Whether this browser can decode a QR at all. */
export function canScanQr(): boolean {
  return detectorClass() !== null;
}

/**
 * Whether a camera can be opened.
 *
 * Separate from decoding: a desktop browser may decode happily and have no
 * camera, and an insecure origin has `mediaDevices` missing entirely. Offering
 * a camera button that fails on click is worse than not offering one.
 */
export function canUseCamera(): boolean {
  return (
    canScanQr() &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function createDetector(): BarcodeDetectorLike | null {
  const Detector = detectorClass();
  if (!Detector) return null;

  try {
    return new Detector({ formats: ['qr_code'] });
  } catch {
    /**
     * Some builds reject the options object while still supporting the
     * default. Worth a second attempt rather than reporting the whole
     * feature missing.
     */
    try {
      return new Detector();
    } catch {
      return null;
    }
  }
}

/** The first QR found in an image, or null. */
export async function scanImage(file: Blob): Promise<string | null> {
  const detector = createDetector();
  if (!detector) return null;

  try {
    /**
     * Decoded from an `ImageBitmap` rather than the Blob directly. Passing a
     * Blob works in some browsers and throws in others, while every
     * implementation that has the API accepts a bitmap.
     */
    const bitmap = await createImageBitmap(file);

    try {
      const found = await detector.detect(bitmap);
      return found[0]?.rawValue ?? null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export interface CameraScan {
  /** Stops the camera and the scan loop. Safe to call twice. */
  stop(): void;
}

/**
 * Watches a video element until a code appears.
 *
 * Polls rather than hooking a frame callback, because `requestVideoFrameCallback`
 * is not everywhere and a scan every 250ms is well inside what a person
 * experiences as instant. Detection is skipped while one is already running so
 * a slow decode cannot pile up behind itself.
 */
export async function scanCamera(
  video: HTMLVideoElement,
  onFound: (value: string) => void,
  onError: (message: string) => void
): Promise<CameraScan> {
  const detector = createDetector();

  if (!detector || !navigator.mediaDevices?.getUserMedia) {
    onError('This browser cannot scan codes.');
    return { stop: () => undefined };
  }

  let stream: MediaStream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // The back camera on a phone; ignored where there is only one
      video: { facingMode: 'environment' },
    });
  } catch {
    onError(
      'Could not open the camera. It may be in use, or permission was declined.'
    );
    return { stop: () => undefined };
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => undefined);

  let stopped = false;
  let busy = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;

    window.clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  const timer = window.setInterval(async () => {
    if (stopped || busy || video.readyState < 2) return;

    busy = true;

    try {
      const found = await detector.detect(video);
      const value = found[0]?.rawValue;

      if (value) {
        stop();
        onFound(value);
      }
    } catch {
      // A dropped frame is not worth reporting; the next tick tries again
    } finally {
      busy = false;
    }
  }, 250);

  return { stop };
}

/**
 * Pulls a cashu token out of whatever was scanned.
 *
 * A code can carry the bare token, a `cashu:` URI, or a link with the token in
 * a fragment — wallets differ. Reading only the bare form would fail on codes
 * this app did not itself produce, which is most of the ones worth scanning.
 */
export function extractToken(scanned: string): string | null {
  const value = scanned.trim();
  if (!value) return null;

  const withoutScheme = value.replace(/^(cashu|web\+cashu|lightning):/i, '');
  if (/^cashu[AB]/i.test(withoutScheme)) return withoutScheme;

  // A URL carrying the token in its fragment or query
  const match = value.match(/cashu[AB][A-Za-z0-9\-_=+/]+/i);
  return match ? match[0] : null;
}
