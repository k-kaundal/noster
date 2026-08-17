import '@testing-library/jest-dom';
import { vi } from 'vitest';

/*
 * Everything below stubs browser APIs, and a test file can ask for the `node`
 * environment instead — the build script's tests do, because they import
 * esbuild, which will not load under jsdom. Setup runs for those too, so it
 * has to notice there is no browser to stub rather than throwing before the
 * file is even collected.
 */
const browser = typeof window !== 'undefined';

// Mock window.matchMedia
if (browser) Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock window.scrollTo
if (browser) Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation((_callback) => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
  root: null,
  rootMargin: '',
  thresholds: [],
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation((_callback) => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));