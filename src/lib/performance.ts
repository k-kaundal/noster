/**
 * Performance optimization utilities for NostrFeed
 * Includes lazy loading, caching, and resource management strategies
 */

/**
 * Intersection Observer for infinite scroll and lazy loading
 */
export function createIntersectionObserver(
  callback: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit
): IntersectionObserver {
  return new IntersectionObserver(callback, {
    rootMargin: '600px',
    threshold: 0.1,
    ...options,
  });
}

/**
 * Debounce function for expensive operations
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function for frequent events
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;

  return function (...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * Request idle callback with polyfill
 */
export function requestIdleTask(callback: () => void, timeout = 5000): number {
  if ('requestIdleCallback' in window) {
    return (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => number }).requestIdleCallback(
      callback,
      { timeout }
    );
  }
  return window.setTimeout(callback, 0) as unknown as number;
}

/**
 * Cancel idle task
 */
export function cancelIdleTask(id: number): void {
  if ('cancelIdleCallback' in window) {
    (window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id);
  } else {
    clearTimeout(id);
  }
}

/**
 * Prefetch resource for better performance
 */
export function prefetchResource(url: string, type: 'script' | 'style' | 'image' = 'script'): void {
  if (type === 'script') {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'script';
    link.href = url;
    document.head.appendChild(link);
  } else if (type === 'style') {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'style';
    link.href = url;
    document.head.appendChild(link);
  } else {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'image';
    link.href = url;
    document.head.appendChild(link);
  }
}

/**
 * Memory-efficient cache with TTL
 */
export class CacheWithTTL<T> {
  private cache = new Map<string, { value: T; expires: number }>();

  set(key: string, value: T, ttlMs = 5 * 60 * 1000): void {
    this.cache.set(key, {
      value,
      expires: Date.now() + ttlMs,
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

/**
 * Network request batching and deduplication
 */
export class RequestBatcher {
  private pending = new Map<string, Promise<unknown>>();

  async batch<T>(
    key: string,
    fn: () => Promise<T>,
    options = { deduplicate: true }
  ): Promise<T> {
    if (options.deduplicate && this.pending.has(key)) {
      return this.pending.get(key) as Promise<T>;
    }

    const promise = fn()
      .then((result) => {
        this.pending.delete(key);
        return result;
      })
      .catch((error) => {
        this.pending.delete(key);
        throw error;
      });

    this.pending.set(key, promise);
    return promise;
  }
}

/**
 * Track and measure performance metrics
 */
export class PerformanceTracker {
  private marks = new Map<string, number>();

  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  measure(name: string): number {
    const start = this.marks.get(name);
    if (!start) return 0;

    const duration = performance.now() - start;
    this.marks.delete(name);

    if (typeof window !== 'undefined' && window.performance) {
      try {
        window.performance.measure(name, { start, duration });
      } catch {
        // Browser doesn't support measure API
      }
    }

    return duration;
  }

  log(name: string): void {
    const duration = this.measure(name);
    console.log(`⏱️ ${name}: ${duration.toFixed(2)}ms`);
  }
}
