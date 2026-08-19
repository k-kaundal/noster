import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';

import { MAX_HITS, parseDirectory, searchDirectory } from './getzap';

const HEX = 'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6';
const NPUB = nip19.npubEncode(HEX);

/** A row shaped the way the OpenAPI document says one is shaped. */
const hit = (over: Record<string, unknown> = {}) => ({
  name: 'kk',
  identity: 'kk@getzap.me',
  npub: NPUB,
  pubkey: HEX,
  active: true,
  lud16: 'kk@getzap.me',
  ...over,
});

describe('parseDirectory', () => {
  it('reads a well-formed answer', () => {
    const [found] = parseDirectory({ results: [hit()] });

    expect(found).toMatchObject({
      name: 'kk',
      identity: 'kk@getzap.me',
      pubkey: HEX,
      npub: NPUB,
      active: true,
    });
  });

  it('accepts a row that carries only an npub', () => {
    // `pubkey` and `npub` are both optional in the schema, so neither can be
    // assumed present
    const [found] = parseDirectory({
      results: [hit({ pubkey: undefined })],
    });

    expect(found.pubkey).toBe(HEX);
  });

  it('accepts a row that carries only hex', () => {
    const [found] = parseDirectory({ results: [hit({ npub: undefined })] });
    expect(found.npub).toBe(NPUB);
  });

  it('drops a row whose key cannot be read', () => {
    /*
     * A hit with no usable key is a link to nowhere. This is a separate
     * service on a separate deployment cycle, so its answers are checked
     * rather than trusted.
     */
    expect(parseDirectory({ results: [hit({ pubkey: 'nonsense', npub: 'x' })] }))
      .toEqual([]);
  });

  it('treats a missing active flag as live', () => {
    // Optional in the schema; hiding names because a deployment omits it would
    // make the whole directory look empty
    expect(parseDirectory({ results: [hit({ active: undefined })] })[0].active)
      .toBe(true);
  });

  it('keeps an inactive name, marked', () => {
    // A lapsed reservation still answers "is this taken"
    expect(parseDirectory({ results: [hit({ active: false })] })[0].active)
      .toBe(false);
  });

  it('falls back to the local part when no name is given', () => {
    expect(parseDirectory({ results: [hit({ name: undefined })] })[0].name)
      .toBe('kk');
  });

  it('counts the same identity once', () => {
    expect(parseDirectory({ results: [hit(), hit()] })).toHaveLength(1);
  });

  it('keeps two names held by one person as two', () => {
    // One key may hold several names, and each is its own thing to search for
    const found = parseDirectory({
      results: [hit(), hit({ name: 'kamlesh', identity: 'kamlesh@getzap.me' })],
    });

    expect(found).toHaveLength(2);
  });

  it('caps how many reach the search box', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      hit({ name: `n${index}`, identity: `n${index}@getzap.me` })
    );

    expect(parseDirectory({ results: many })).toHaveLength(MAX_HITS);
  });

  it('survives every shape that is not the documented one', () => {
    /*
     * The whole point of parsing rather than casting. A client that assumes
     * the shape it was promised white-screens the day the shape changes.
     */
    expect(parseDirectory(null)).toEqual([]);
    expect(parseDirectory(undefined)).toEqual([]);
    expect(parseDirectory({})).toEqual([]);
    expect(parseDirectory({ results: 'nope' })).toEqual([]);
    expect(parseDirectory({ results: [null, 42, 'x'] })).toEqual([]);
    expect(parseDirectory([hit()])).toEqual([]);
  });
});

describe('searchDirectory', () => {
  /*
   * Pointed at a directory explicitly. `GETZAP_API` is empty in tests — and in
   * any deployment that has not configured one — so without this every
   * assertion below would pass by returning early, which is worse than no test
   * at all.
   */
  const BASE = 'https://api.example/v1';

  const ok = (body: unknown) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

  it('asks for nothing on a term too short to mean anything', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;

    expect(
      await searchDirectory('k', { fetchImpl: spy, baseUrl: BASE })
    ).toEqual([]);
    expect(called).toBe(false);
  });

  it('returns nothing rather than throwing when the API is unreachable', async () => {
    /*
     * The contract the search box depends on. This decorates a search; there
     * is no failure here worth turning into an error state, and "unreachable"
     * and "no matches" look the same to somebody typing.
     */
    const dead = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    await expect(
      searchDirectory('kk', { fetchImpl: dead, baseUrl: BASE })
    ).resolves.toEqual([]);
  });

  it('returns nothing on a refusal', async () => {
    const refused = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;

    await expect(
      searchDirectory('kk', { fetchImpl: refused, baseUrl: BASE })
    ).resolves.toEqual([]);
  });

  it('returns nothing when the body is not JSON', async () => {
    const html = (async () =>
      new Response('<!doctype html>', { status: 200 })) as unknown as typeof fetch;

    await expect(
      searchDirectory('kk', { fetchImpl: html, baseUrl: BASE })
    ).resolves.toEqual([]);
  });

  it('parses a good answer', async () => {
    const found = await searchDirectory('kk', {
      fetchImpl: ok({ results: [hit()] }),
      baseUrl: BASE,
    });

    expect(found).toHaveLength(1);
    expect(found[0].identity).toBe('kk@getzap.me');
  });

  it('asks the documented endpoint, with the term escaped', async () => {
    let asked = '';
    const spy = (async (url: string) => {
      asked = String(url);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await searchDirectory('a b&c', { fetchImpl: spy, baseUrl: BASE });

    expect(asked).toBe(`${BASE}/search?q=a%20b%26c`);
  });

  it('issues nothing at all when no directory is configured', async () => {
    // The unconfigured case is the default, and it must cost nothing
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;

    expect(await searchDirectory('kk', { fetchImpl: spy })).toEqual([]);
    expect(called).toBe(false);
  });
});
