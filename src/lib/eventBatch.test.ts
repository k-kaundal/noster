import { describe, it, expect, vi } from 'vitest';
import { createEventBatcher } from './eventBatch';

interface Item {
  id: string;
  at?: number;
}

/**
 * A clock that only moves when told to.
 *
 * Real timers would make these tests slow and flaky in equal measure, and the
 * thing under test is precisely *when* work happens.
 */
function fakeClock() {
  const jobs = new Map<number, () => void>();
  let next = 1;

  return {
    schedule(callback: () => void) {
      const handle = next++;
      jobs.set(handle, callback);
      return handle;
    },
    cancel(handle: number) {
      jobs.delete(handle);
    },
    tick() {
      const due = [...jobs.entries()];
      jobs.clear();
      for (const [, callback] of due) callback();
    },
    get pending() {
      return jobs.size;
    },
  };
}

function batcherWith(
  onFlush: (items: Item[]) => void,
  overrides: Partial<Parameters<typeof createEventBatcher<Item>>[0]> = {}
) {
  const clock = fakeClock();

  const batcher = createEventBatcher<Item>({
    key: (item) => item.id,
    onFlush,
    schedule: clock.schedule,
    cancel: clock.cancel,
    ...overrides,
  });

  return { batcher, clock };
}

describe('createEventBatcher', () => {
  it('hands over one batch rather than one call per item', () => {
    /**
     * The whole point. Ten events written straight to a store is ten renders
     * of everything subscribed to it; on a busy feed that is what stops the
     * page responding.
     */
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush);

    for (let index = 0; index < 10; index += 1) {
      batcher.push({ id: `event-${index}` });
    }

    expect(onFlush).not.toHaveBeenCalled();

    clock.tick();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toHaveLength(10);
  });

  it('collapses the same event arriving from several relays', () => {
    // Replication is the normal case on Nostr, not an anomaly
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush);

    batcher.push({ id: 'abc' });
    batcher.push({ id: 'abc' });
    batcher.push({ id: 'abc' });
    clock.tick();

    expect(onFlush.mock.calls[0][0]).toEqual([{ id: 'abc' }]);
  });

  it('keeps a repeat in its original place in the queue', () => {
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush);

    batcher.push({ id: 'first' });
    batcher.push({ id: 'second' });
    batcher.push({ id: 'first' });
    clock.tick();

    expect(onFlush.mock.calls[0][0].map((item: Item) => item.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('flushes early when a burst is big enough to matter', () => {
    const onFlush = vi.fn();
    const { batcher } = batcherWith(onFlush, { maxBatch: 3 });

    batcher.push({ id: 'a' });
    batcher.push({ id: 'b' });
    expect(onFlush).not.toHaveBeenCalled();

    batcher.push({ id: 'c' });

    // No tick: a burst that has already filled the batch should not also sit
    // out the timer
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('drops the oldest when the buffer overflows', () => {
    /**
     * A reader returning to a firehose wants the last few seconds of it, not
     * a minute of backlog rendered at once. So the buffer keeps the newest.
     */
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush, {
      maxBuffer: 2,
      maxBatch: 99,
    });

    batcher.push({ id: 'oldest' });
    batcher.push({ id: 'middle' });
    batcher.push({ id: 'newest' });
    clock.tick();

    expect(onFlush.mock.calls[0][0].map((item: Item) => item.id)).toEqual([
      'middle',
      'newest',
    ]);
    expect(batcher.dropped).toBe(1);
  });

  it('sorts a batch when told how', () => {
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush, {
      compare: (a, b) => (b.at ?? 0) - (a.at ?? 0),
    });

    batcher.push({ id: 'old', at: 1 });
    batcher.push({ id: 'new', at: 3 });
    batcher.push({ id: 'mid', at: 2 });
    clock.tick();

    expect(onFlush.mock.calls[0][0].map((item: Item) => item.id)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('starts a fresh window after each flush', () => {
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush);

    batcher.push({ id: 'a' });
    clock.tick();
    batcher.push({ id: 'b' });
    clock.tick();

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0]).toEqual([{ id: 'b' }]);
  });

  it('does nothing when the window closes on an empty queue', () => {
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush);

    batcher.push({ id: 'a' });
    clock.tick();
    onFlush.mockClear();

    clock.tick();

    expect(onFlush).not.toHaveBeenCalled();
  });

  it('drops what is waiting when disposed, and accepts nothing after', () => {
    // Unmounting mid-window must not write into a cache the component that
    // owned it has already left
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush);

    batcher.push({ id: 'a' });
    batcher.dispose();
    clock.tick();

    batcher.push({ id: 'b' });
    clock.tick();

    expect(onFlush).not.toHaveBeenCalled();
    expect(batcher.size).toBe(0);
  });

  it('cancels its timer on dispose rather than leaving one running', () => {
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush);

    batcher.push({ id: 'a' });
    expect(clock.pending).toBe(1);

    batcher.dispose();

    expect(clock.pending).toBe(0);
  });

  it('flushes on demand without waiting for the window', () => {
    const onFlush = vi.fn();
    const { batcher, clock } = batcherWith(onFlush);

    batcher.push({ id: 'a' });
    batcher.flush();

    expect(onFlush).toHaveBeenCalledTimes(1);
    // And the pending timer is gone, so the window does not fire empty later
    expect(clock.pending).toBe(0);
  });
});
