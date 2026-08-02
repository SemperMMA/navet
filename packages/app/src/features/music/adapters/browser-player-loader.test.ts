import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadExternalBrowserScript, waitForBrowserCallback } from './browser-player-loader';

const SCRIPT_SRC = 'https://provider.example.test/player.js';

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll(`script[src="${SCRIPT_SRC}"]`).forEach((script) => {
    script.remove();
  });
});

describe('browser player loader', () => {
  it('times out a stale script and allows a clean retry', async () => {
    vi.useFakeTimers();
    const stale = document.createElement('script');
    stale.src = SCRIPT_SRC;
    document.head.append(stale);
    let ready = false;

    const first = loadExternalBrowserScript({
      src: SCRIPT_SRC,
      isReady: () => ready,
      errorMessage: 'Provider player failed',
      timeoutMs: 100,
    });
    const firstResult = expect(first).rejects.toThrow('Provider player failed (timed out)');
    await vi.advanceTimersByTimeAsync(100);
    await firstResult;
    expect(stale).not.toBeInTheDocument();

    const second = loadExternalBrowserScript({
      src: SCRIPT_SRC,
      isReady: () => ready,
      errorMessage: 'Provider player failed',
      timeoutMs: 100,
    });
    const replacement = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    expect(replacement).not.toBe(stale);
    ready = true;
    replacement?.dispatchEvent(new Event('load'));

    await expect(second).resolves.toBeUndefined();
  });

  it('bounds provider SDK methods that never invoke their callback', async () => {
    vi.useFakeTimers();
    const result = waitForBrowserCallback<void>(() => undefined, 'Provider callback timed out', 50);
    const assertion = expect(result).rejects.toThrow('Provider callback timed out');

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});
