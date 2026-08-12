import { describe, it, expect, afterEach, vi } from 'vitest';
import { installRoute, isIos, isIosSafari, isStandalone } from './install';

/** Real user-agent strings, so the regexes are tested against what ships. */
const AGENTS = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15',
  ipadOS:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};

function pretend(agent: string, touchPoints = 0, standalone = false) {
  vi.stubGlobal('navigator', {
    userAgent: agent,
    maxTouchPoints: touchPoints,
    standalone,
  });

  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isIos', () => {
  it('recognises iPhones', () => {
    pretend(AGENTS.iphoneSafari);
    expect(isIos()).toBe(true);
  });

  it('recognises an iPad, which claims to be a Mac', () => {
    /**
     * iPadOS reports a desktop Macintosh agent. Without the touch-point check
     * every iPad falls through to "no install offer", which is the gap this
     * module exists to close.
     */
    pretend(AGENTS.ipadOS, 5);
    expect(isIos()).toBe(true);
  });

  it('does not mistake a real Mac for one', () => {
    pretend(AGENTS.macSafari, 0);
    expect(isIos()).toBe(false);
  });

  it('says no to Android and Windows', () => {
    pretend(AGENTS.androidChrome);
    expect(isIos()).toBe(false);

    pretend(AGENTS.windowsChrome);
    expect(isIos()).toBe(false);
  });
});

describe('isIosSafari', () => {
  it('accepts Safari on an iPhone', () => {
    pretend(AGENTS.iphoneSafari);
    expect(isIosSafari()).toBe(true);
  });

  it('rejects other browsers on iOS, which cannot install at all', () => {
    // Sending these the Share-sheet steps points at a menu item they lack
    pretend(AGENTS.iphoneChrome);
    expect(isIosSafari()).toBe(false);

    pretend(AGENTS.iphoneFirefox);
    expect(isIosSafari()).toBe(false);
  });
});

describe('isStandalone', () => {
  it('reads Apple\'s own flag, which is the only one iOS sets', () => {
    pretend(AGENTS.iphoneSafari, 5, true);
    expect(isStandalone()).toBe(true);
  });

  it('is false in an ordinary tab', () => {
    pretend(AGENTS.iphoneSafari, 5, false);
    expect(isStandalone()).toBe(false);
  });
});

describe('installRoute', () => {
  it('uses the browser prompt when there is one', () => {
    pretend(AGENTS.androidChrome);
    expect(installRoute(true)).toBe('prompt');
  });

  it('falls back to the Share sheet on iOS Safari', () => {
    pretend(AGENTS.iphoneSafari);
    expect(installRoute(false)).toBe('ios-share');
  });

  it('offers nothing where nothing can be done', () => {
    // Chrome on iOS cannot install, and no prompt is coming
    pretend(AGENTS.iphoneChrome);
    expect(installRoute(false)).toBe('none');

    // Desktop that has not offered a prompt
    pretend(AGENTS.windowsChrome);
    expect(installRoute(false)).toBe('none');
  });

  it('reports an already-installed app before anything else', () => {
    pretend(AGENTS.iphoneSafari, 5, true);
    expect(installRoute(false)).toBe('installed');
    expect(installRoute(true)).toBe('installed');
  });
});
