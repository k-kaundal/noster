/**
 * Saving a file from the browser, and knowing whether it worked.
 *
 * `<a download>` is the usual trick and it has a failure mode that matters
 * here: inside a WebView — an installed iOS PWA, or a Capacitor shell — the
 * click does nothing at all and throws nothing either. Code that assumes
 * success carries on and tells the person their file is saved.
 *
 * That is survivable for a code snippet. For the secret key handed to somebody
 * during signup it is the whole account: they tap save, see a confirmation,
 * close the dialog, and have nothing.
 *
 * So every path here reports what actually happened, and the caller is
 * expected to act on `false` rather than assume.
 */

export type SaveOutcome = 'saved' | 'shared' | 'cancelled' | 'unsupported';

/**
 * Whether `<a download>` can be trusted.
 *
 * iOS is the case that matters. Safari has never honoured the attribute the
 * way other browsers do, and in a standalone PWA or a WKWebView the click is
 * inert. Detected by platform rather than feature, because the attribute is
 * present and settable everywhere — there is nothing to feature-detect.
 */
function anchorDownloadWorks(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  return !isIos;
}

/** Whether the browser will take a file through the share sheet. */
function canShareFile(file: File): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  );
}

/**
 * Offers a file to the reader, however this platform actually does that.
 *
 * The share sheet first on platforms where downloading does not work, because
 * on a phone it is the real equivalent — it reaches Files, Notes, a password
 * manager, anywhere the person might want to put a key.
 */
export async function saveFile(
  contents: string | Blob,
  filename: string,
  type = 'text/plain;charset=utf-8'
): Promise<SaveOutcome> {
  const blob =
    typeof contents === 'string' ? new Blob([contents], { type }) : contents;

  if (!anchorDownloadWorks()) {
    const file = new File([blob], filename, { type: blob.type || type });

    if (canShareFile(file)) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (error) {
        /**
         * A dismissed share sheet rejects with AbortError. Reported as
         * cancelled rather than failed: nothing went wrong, the person
         * changed their mind, and telling them it failed would send them
         * looking for a problem.
         */
        return (error as Error)?.name === 'AbortError'
          ? 'cancelled'
          : 'unsupported';
      }
    }

    /**
     * No share sheet and no working download. Saying so is the point — the
     * alternative is the silent no-op this whole module exists to stop.
     */
    return 'unsupported';
  }

  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    return 'saved';
  } finally {
    /**
     * Revoked on a timer rather than immediately. Some browsers have not
     * finished reading the blob when the click returns, and revoking under
     * them produces an empty file — which for a key backup is the same
     * disaster as no file, only quieter.
     */
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
