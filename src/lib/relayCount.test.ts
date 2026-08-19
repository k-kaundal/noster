import { describe, it, expect, vi } from 'vitest';
import { countEvents, parseCountFrame, type CountSocket } from './relayCount';

describe('parseCountFrame', () => {
  const sub = 'count-1';

  it('reads the count', () => {
    expect(parseCountFrame(JSON.stringify(['COUNT', sub, { count: 42 }]), sub))
      .toEqual({ type: 'count', count: 42, approximate: false });
  });

  it('carries the relay admitting it estimated', () => {
    expect(
      parseCountFrame(
        JSON.stringify(['COUNT', sub, { count: 9000, approximate: true }]),
        sub
      )
    ).toMatchObject({ approximate: true });
  });

  it('ignores an answer to somebody else', () => {
    /*
     * A COUNT shares its connection with every other subscription on it, so a
     * frame naming a different id is not an error — it is somebody else's
     * answer, and taking it would report the wrong number entirely.
     */
    expect(parseCountFrame(JSON.stringify(['COUNT', 'other', { count: 1 }]), sub))
      .toBeNull();
  });

  it('ignores events and end-of-stream frames', () => {
    expect(parseCountFrame(JSON.stringify(['EVENT', sub, {}]), sub)).toBeNull();
    expect(parseCountFrame(JSON.stringify(['EOSE', sub]), sub)).toBeNull();
  });

  it('reads a CLOSED as the relay declining', () => {
    expect(
      parseCountFrame(JSON.stringify(['CLOSED', sub, 'unsupported']), sub)
    ).toEqual({ type: 'closed', reason: 'unsupported' });
  });

  it('reports a NOTICE without matching it to a subscription', () => {
    // A NOTICE carries no subscription id, so it can only ever be reported
    expect(parseCountFrame(JSON.stringify(['NOTICE', 'slow down']), sub))
      .toEqual({ type: 'notice', reason: 'slow down' });
  });

  it('survives anything that is not a frame', () => {
    expect(parseCountFrame('not json', sub)).toBeNull();
    expect(parseCountFrame(JSON.stringify({ count: 5 }), sub)).toBeNull();
    expect(parseCountFrame(null, sub)).toBeNull();
    expect(parseCountFrame(new ArrayBuffer(4), sub)).toBeNull();
  });

  it('refuses a COUNT with no usable number', () => {
    /*
     * A relay that answers the verb without the number has told us nothing,
     * and treating a missing count as zero would report "no followers" for
     * somebody with thousands.
     */
    expect(parseCountFrame(JSON.stringify(['COUNT', sub, {}]), sub)).toBeNull();
    expect(
      parseCountFrame(JSON.stringify(['COUNT', sub, { count: '12' }]), sub)
    ).toBeNull();
    expect(
      parseCountFrame(JSON.stringify(['COUNT', sub, { count: -1 }]), sub)
    ).toBeNull();
    expect(parseCountFrame(JSON.stringify(['COUNT', sub, null]), sub)).toBeNull();
  });
});

/** A socket that opens on the next tick and answers whatever it is told to. */
function fakeSocket(
  reply?: (frame: string) => string | undefined,
  options: { failOnSend?: boolean } = {}
) {
  const handlers = new Map<string, ((event?: unknown) => void)[]>();
  const socket = {
    sent: [] as string[],
    closed: false,
    readyState: 0,
    send(data: string) {
      if (options.failOnSend) throw new Error('not open');
      socket.sent.push(data);

      const answer = reply?.(data);
      if (answer === undefined) return;
      queueMicrotask(() => socket.emit('message', { data: answer }));
    },
    close() {
      socket.closed = true;
    },
    addEventListener(type: string, handler: (event?: unknown) => void) {
      const held = handlers.get(type) ?? [];
      held.push(handler);
      handlers.set(type, held);

      if (type === 'open') queueMicrotask(() => handler());
    },
    emit(type: string, event?: unknown) {
      for (const handler of handlers.get(type) ?? []) handler(event);
    },
  };

  return socket;
}

describe('countEvents', () => {
  it('sends a COUNT and resolves the answer', async () => {
    const socket = fakeSocket((frame) => {
      const [verb, subId, filter] = JSON.parse(frame);
      expect(verb).toBe('COUNT');
      expect(filter).toEqual({ kinds: [3], '#p': ['abc'] });
      return JSON.stringify(['COUNT', subId, { count: 1204 }]);
    });

    const result = await countEvents(
      'wss://relay.example',
      [{ kinds: [3], '#p': ['abc'] }],
      { connect: () => socket as unknown as CountSocket }
    );

    expect(result).toEqual({ count: 1204, approximate: false });
  });

  it('closes the subscription once it has its answer', async () => {
    /*
     * A COUNT left open stays open on the relay until the connection drops,
     * and this app opens one per profile visited.
     */
    const socket = fakeSocket((frame) =>
      JSON.stringify(['COUNT', JSON.parse(frame)[1], { count: 1 }])
    );

    await countEvents('wss://relay.example', [{ kinds: [3] }], {
      connect: () => socket as unknown as CountSocket,
    });

    expect(socket.closed).toBe(true);
  });

  it('gives up quietly when the relay never answers', async () => {
    /*
     * A relay that does not implement NIP-45 usually says nothing at all
     * rather than refusing, so silence has to resolve rather than hang — every
     * caller has a slower path to fall back to.
     */
    vi.useFakeTimers();

    const socket = fakeSocket(() => undefined);
    const pending = countEvents('wss://relay.example', [{ kinds: [3] }], {
      connect: () => socket as unknown as CountSocket,
      timeout: 1000,
    });

    await vi.advanceTimersByTimeAsync(1001);
    await expect(pending).resolves.toBeNull();

    vi.useRealTimers();
  });

  it('gives up when the relay closes the subscription', async () => {
    const socket = fakeSocket((frame) =>
      JSON.stringify(['CLOSED', JSON.parse(frame)[1], 'unsupported: COUNT'])
    );

    await expect(
      countEvents('wss://relay.example', [{ kinds: [3] }], {
        connect: () => socket as unknown as CountSocket,
      })
    ).resolves.toBeNull();
  });

  it('gives up when the connection errors', async () => {
    const socket = fakeSocket(() => undefined);
    const pending = countEvents('wss://relay.example', [{ kinds: [3] }], {
      connect: () => socket as unknown as CountSocket,
    });

    queueMicrotask(() => socket.emit('error'));
    await expect(pending).resolves.toBeNull();
  });

  it('gives up when the socket cannot be opened at all', async () => {
    await expect(
      countEvents('wss://relay.example', [{ kinds: [3] }], {
        connect: () => {
          throw new Error('blocked');
        },
      })
    ).resolves.toBeNull();
  });

  it('gives up when sending throws', async () => {
    const socket = fakeSocket(undefined, { failOnSend: true });

    await expect(
      countEvents('wss://relay.example', [{ kinds: [3] }], {
        connect: () => socket as unknown as CountSocket,
      })
    ).resolves.toBeNull();
  });

  it('resolves immediately when the signal is already aborted', async () => {
    const socket = fakeSocket(() => undefined);

    await expect(
      countEvents('wss://relay.example', [{ kinds: [3] }], {
        connect: () => socket as unknown as CountSocket,
        signal: AbortSignal.abort(),
      })
    ).resolves.toBeNull();
  });

  it('gives every request its own subscription id', async () => {
    const ids: string[] = [];
    const take = (frame: string) => {
      ids.push(JSON.parse(frame)[1]);
      return JSON.stringify(['COUNT', JSON.parse(frame)[1], { count: 0 }]);
    };

    await countEvents('wss://a', [{ kinds: [3] }], {
      connect: () => fakeSocket(take) as unknown as CountSocket,
    });
    await countEvents('wss://a', [{ kinds: [3] }], {
      connect: () => fakeSocket(take) as unknown as CountSocket,
    });

    expect(ids[0]).not.toBe(ids[1]);
  });

  it('sends without waiting when the socket is already open', async () => {
    const socket = fakeSocket((frame) =>
      JSON.stringify(['COUNT', JSON.parse(frame)[1], { count: 7 }])
    );
    socket.readyState = 1;

    await expect(
      countEvents('wss://relay.example', [{ kinds: [3] }], {
        connect: () => socket as unknown as CountSocket,
      })
    ).resolves.toEqual({ count: 7, approximate: false });
  });
});
