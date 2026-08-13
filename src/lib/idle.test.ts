import { describe, it, expect, vi, afterEach } from 'vitest';
import { runWhenIdle } from './idle';

interface IdleScope {
  requestIdleCallback?: unknown;
  cancelIdleCallback?: unknown;
}

const scope = globalThis as unknown as IdleScope;

afterEach(() => {
  delete scope.requestIdleCallback;
  delete scope.cancelIdleCallback;
  vi.useRealTimers();
});

describe('runWhenIdle', () => {
  it('uses the browser primitive when there is one', () => {
    const request = vi.fn().mockReturnValue(7);
    const cancel = vi.fn();
    scope.requestIdleCallback = request;
    scope.cancelIdleCallback = cancel;

    const task = vi.fn();
    const handle = runWhenIdle(task, 1234);

    expect(request).toHaveBeenCalledWith(task, { timeout: 1234 });

    handle.cancel();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('always passes a timeout, so a busy page still runs the work', () => {
    /**
     * Without one, a page that never goes idle — which is any page with an
     * animation on it — never runs the callback at all, and the prefetch
     * meant to make a tab instant simply never happens.
     */
    const request = vi.fn().mockReturnValue(1);
    scope.requestIdleCallback = request;

    runWhenIdle(() => {});

    expect(request.mock.calls[0][1]).toHaveProperty('timeout');
  });

  it('falls back to a timer where the primitive is missing', () => {
    // Safari shipped it late and jsdom has never had it
    vi.useFakeTimers();
    const task = vi.fn();

    runWhenIdle(task, 500);
    expect(task).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('cancels the fallback timer', () => {
    vi.useFakeTimers();
    const task = vi.fn();

    runWhenIdle(task, 500).cancel();
    vi.advanceTimersByTime(1000);

    expect(task).not.toHaveBeenCalled();
  });
});
