interface ExternalBrowserScriptOptions {
  src: string;
  isReady: () => boolean;
  errorMessage: string;
  timeoutMs?: number;
}

const DEFAULT_SCRIPT_TIMEOUT_MS = 10_000;
const SCRIPT_READY_POLL_MS = 50;

/**
 * Loads a provider-owned browser SDK without trusting a possibly missed script load event.
 * Failed and stalled script elements are removed so a later user retry can start cleanly.
 */
export function loadExternalBrowserScript({
  src,
  isReady,
  errorMessage,
  timeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS,
}: ExternalBrowserScriptOptions): Promise<void> {
  if (isReady()) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const script = existing ?? document.createElement('script');
    let settled = false;

    const cleanup = () => {
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      script.removeEventListener('load', checkReady);
      script.removeEventListener('error', handleError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve();
      }
    };
    const checkReady = () => {
      if (isReady()) finish();
    };
    const handleError = () => finish(new Error(errorMessage));
    const pollId = window.setInterval(checkReady, SCRIPT_READY_POLL_MS);
    const timeoutId = window.setTimeout(
      () => finish(new Error(`${errorMessage} (timed out)`)),
      timeoutMs
    );

    script.addEventListener('load', checkReady);
    script.addEventListener('error', handleError, { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.append(script);
    }
    checkReady();
  });
}

/** Wraps callback-only provider SDK methods so a missing callback cannot stall Navet forever. */
export function waitForBrowserCallback<T>(
  subscribe: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
  errorMessage: string,
  timeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      reject(error);
    };
    const timeoutId = window.setTimeout(() => fail(new Error(errorMessage)), timeoutMs);

    try {
      subscribe(finish, fail);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(errorMessage));
    }
  });
}
