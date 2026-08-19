/**
 * Runtime stand-in for `@nostrify/nostrify/uploaders`.
 *
 * Returns a data URI rather than uploading. Blossom servers are on the far side
 * of a network this harness does not have, and an upload button that hangs for
 * thirty seconds and then throws is not a design you can review — whereas one
 * that returns instantly lets you see the *filled* state, which is the state
 * worth looking at.
 */
export class BlossomUploader {
  constructor(options = {}) {
    this.options = options;
  }

  async upload(file) {
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    // NIP-94 shape: the first tag carries the URL, which is all callers read
    return [
      ['url', url],
      ['m', file.type || 'application/octet-stream'],
      ['size', String(file.size)],
    ];
  }
}
