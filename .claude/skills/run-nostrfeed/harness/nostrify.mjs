/**
 * Runtime stand-in for `@nostrify/nostrify`.
 *
 * The installed package is `0.0.0-types-only-stub`: declaration files and
 * nothing else, because this container cannot reach jsr.io. Types are enough
 * for `tsc` and for tests that only import types, which is why the suite goes
 * green while the app cannot boot — the moment Vite tries to resolve the
 * *value* `NPool`, there is nothing there.
 *
 * This provides the values, backed by fixtures instead of websockets. Only the
 * surface this app actually imports is implemented; see SKILL.md for how that
 * list was derived and what to do when it grows.
 */
import { query as queryFixtures } from './fixtures.mjs';

/** Milliseconds of pretend latency, so loading states are reviewable. */
const LATENCY = Number(globalThis.__NOSTRFEED_LATENCY__ ?? 120);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A pool that answers from fixtures.
 *
 * Constructed with the same `{open, reqRouter, eventRouter}` the app passes, and
 * the routers are *called* even though their answers are not dialled — the app
 * has real logic in there (NIP-65 hints, receipt relays, expiry filtering) and
 * running it is how a mistake in it shows up under the harness rather than only
 * in production.
 */
export class NPool {
  constructor(options = {}) {
    this.options = options;
  }

  #route(filters) {
    try {
      this.options.reqRouter?.(filters);
    } catch (error) {
      console.warn('[harness] reqRouter threw', error);
    }
  }

  async query(filters, opts = {}) {
    this.#route(filters);
    await sleep(LATENCY);

    if (opts.signal?.aborted) throw new Error('aborted');
    return queryFixtures(filters);
  }

  async *req(filters, opts = {}) {
    const events = await this.query(filters, opts);

    for (const event of events) {
      yield ['EVENT', 'sub', event];
    }
    yield ['EOSE', 'sub'];
  }

  async event(event) {
    try {
      this.options.eventRouter?.(event);
    } catch (error) {
      console.warn('[harness] eventRouter threw', error);
    }

    await sleep(LATENCY);
    console.info('[harness] published', event.kind, event.id?.slice(0, 8));
    return event;
  }

  /** `nostr.group([url])` — same answers, since there is one fixture set. */
  group() {
    return this;
  }

  relay() {
    return this;
  }

  close() {}
}

/** A relay handle. Never opens a socket; the pool never dials it. */
export class NRelay1 {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
  }

  async query(filters) {
    return queryFixtures(filters);
  }

  async event() {}
  close() {}
}

/**
 * The two schema helpers this app uses, and no more.
 *
 * The real `NSchema` is zod-backed, and zod is not installed here either. The
 * app's entire use of it is `n.json().pipe(n.metadata()).parse(content)`, so
 * that exact chain is what this implements — a parser that throws on bad input,
 * because callers catch and depend on it throwing.
 */
function schema(parse) {
  return {
    parse,
    pipe(next) {
      return schema((value) => next.parse(parse(value)));
    },
  };
}

export const NSchema = {
  json: () =>
    schema((value) => {
      if (typeof value !== 'string') throw new Error('expected a JSON string');
      return JSON.parse(value);
    }),

  metadata: () =>
    schema((value) => {
      if (!value || typeof value !== 'object') {
        throw new Error('expected metadata object');
      }

      const out = {};
      for (const key of [
        'name',
        'display_name',
        'about',
        'picture',
        'banner',
        'nip05',
        'lud06',
        'lud16',
        'website',
      ]) {
        if (typeof value[key] === 'string') out[key] = value[key];
      }
      if (typeof value.bot === 'boolean') out.bot = value.bot;

      return out;
    }),
};
